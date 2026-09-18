const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const WebSocket = require("ws");

const { createWsHub } = require("../runtime/ipc/ws-hub.cjs");
const { GATEWAY_INSTANCE_ID } = require("../runtime/core/config.cjs");

function hello(clientId, gatewayInstanceId = GATEWAY_INSTANCE_ID) {
  return JSON.stringify({ type: "hello", clientId, gatewayInstanceId });
}

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2000);
    const onMessage = (raw) => {
      const message = JSON.parse(String(raw));
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
    };
    socket.on("message", onMessage);
  });
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForClose(socket) {
  return new Promise((resolve) => socket.once("close", resolve));
}

test("rejects stale browser pages before they can reuse AppHost export IDs", async (t) => {
  const server = http.createServer();
  const hub = createWsHub(server, {
    createAppHostRelay() {},
    handleNotificationEvent() {},
    isAuthed: () => true,
  });
  const readyClients = [];
  hub.onClientReady(({ clientId }) => readyClients.push(clientId));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  t.after(async () => {
    socket.close();
    await new Promise((resolve) => server.close(resolve));
  });
  await waitForOpen(socket);
  const expired = waitForMessage(socket, (message) => message.type === "gateway-session-expired");
  const closed = waitForClose(socket);
  socket.send(hello("stale-client", "previous-gateway-instance"));
  const message = await expired;
  await closed;

  assert.equal(message.gatewayInstanceId, GATEWAY_INSTANCE_ID);
  assert.deepEqual(readyClients, []);
});

test("notifies runtime listeners after a browser client completes hello", async (t) => {
  const server = http.createServer();
  const hub = createWsHub(server, {
    createAppHostRelay() {},
    handleNotificationEvent() {},
    isAuthed: () => true,
  });
  const readyClients = [];
  const removedClients = [];
  let resolveRemoved;
  const clientRemoved = new Promise((resolve) => {
    resolveRemoved = resolve;
  });
  hub.onClientReady(({ clientId }) => readyClients.push(clientId));
  hub.onClientRemoved(({ clientId }) => {
    removedClients.push(clientId);
    resolveRemoved();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  t.after(async () => {
    socket.close();
    await new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(hello("ready-client"));
  await waitForMessage(socket, (message) => message.type === "hello-ack");

  assert.deepEqual(readyClients, ["ready-client"]);
  socket.close();
  await waitForClose(socket);
  await clientRemoved;
  assert.deepEqual(removedClients, ["ready-client"]);
});

test("mobile hello stays outside official renderer broadcasts", async (t) => {
  const server = http.createServer();
  const hub = createWsHub(server, {
    createAppHostRelay() {},
    handleNotificationEvent() {},
    isAuthed: () => true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  t.after(async () => {
    socket.close();
    await new Promise((resolve) => server.close(resolve));
  });
  await waitForOpen(socket);
  socket.send(JSON.stringify({
    type: "mobile:hello",
    clientId: "mobile-client",
    gatewayInstanceId: GATEWAY_INSTANCE_ID,
  }));
  const ack = await waitForMessage(socket, (message) => message.type === "mobile:hello-ack");

  assert.equal(ack.clientId, "mobile-client");
  assert.equal(hub.broadcast({ type: "official-state-update" }), 0);
  const liveEvent = waitForMessage(socket, (message) => message.type === "thread.message.delta");
  assert.equal(hub.broadcastMobile({ type: "thread.message.delta", version: 1, sequence: 1, threadId: "thread-one", payload: {} }), 1);
  assert.equal((await liveEvent).threadId, "thread-one");
  assert.equal(hub.clients.size, 1);
});

test("restores app-host downlink before the first post-reconnect data frame", async (t) => {
  const server = http.createServer();
  const relays = [];
  const sockets = [];
  createWsHub(server, {
    createAppHostRelay({ onMessage }) {
      const relay = {
        emitMessage: onMessage,
        messages: [],
        close() {
          this.closed = true;
        },
        postMessage(message) {
          this.messages.push(message);
          return true;
        },
      };
      relays.push(relay);
      return relay;
    },
    handleNotificationEvent() {},
    isAuthed: () => true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const clientId = "reconnecting-client";
  const portId = `app-host-${clientId}-fixture`;
  const first = new WebSocket(url);
  sockets.push(first);
  await waitForOpen(first);
  first.send(hello(clientId));
  await waitForMessage(first, (message) => message.type === "hello-ack");
  first.send(JSON.stringify({ type: "app-host-connect", clientId, portId }));
  await waitForMessage(first, (message) => message.type === "app-host-port-connected");

  first.close();
  await waitForClose(first);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(relays.length, 1);
  assert.equal(relays[0].closed, undefined);
  // 官方回包在短暂断线期间先排队，重连后必须按原 relay/FIFO 补发。
  relays[0].emitMessage("thread/updated");

  const second = new WebSocket(url);
  sockets.push(second);
  await waitForOpen(second);
  const officialMessage = waitForMessage(
    second,
    (message) => message.type === "app-host-port-message" && message.data === "thread/updated"
  );
  second.send(hello(clientId));
  await waitForMessage(second, (message) => message.type === "hello-ack");
  // bridge 在 hello-ack 后主动重发 connect，不依赖新的 browser-to-official RPC 数据。
  second.send(JSON.stringify({ type: "app-host-connect", clientId, portId }));
  await waitForMessage(second, (message) => message.type === "app-host-port-connected");
  await officialMessage;
  assert.equal(relays.length, 1);
});

test("keeps the official app-host relay alive across a BFCache pagehide", async (t) => {
  const server = http.createServer();
  const relays = [];
  const sockets = [];
  createWsHub(server, {
    appHostReconnectGraceMs: 20,
    createAppHostRelay(options) {
      const relay = {
        closed: false,
        close() {
          this.closed = true;
        },
        postMessage() {
          return true;
        },
        onMessage: options.onMessage,
      };
      relays.push(relay);
      return relay;
    },
    handleNotificationEvent() {},
    isAuthed: () => true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const clientId = "bfcache-client";
  const portId = "app-host-bfcache-fixture";
  const first = new WebSocket(url);
  sockets.push(first);
  await waitForOpen(first);
  first.send(hello(clientId));
  await waitForMessage(first, (message) => message.type === "hello-ack");
  first.send(JSON.stringify({ type: "app-host-connect", clientId, portId }));
  await waitForMessage(first, (message) => message.type === "app-host-port-connected");

  // 浏览器进入 BFCache 前会先发 pagehide.persisted=true；即使超过普通网络 grace，
  // 官方 MessagePort 及其 export ID 仍必须保留。
  first.send(
    JSON.stringify({
      type: "opencodex:page-lifecycle",
      clientId,
      lifecycle: "pagehide",
      persisted: true,
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  first.close();
  await waitForClose(first);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(relays.length, 1);
  assert.equal(relays[0].closed, false);

  const second = new WebSocket(url);
  sockets.push(second);
  await waitForOpen(second);
  second.send(hello(clientId));
  await waitForMessage(second, (message) => message.type === "hello-ack");
  second.send(JSON.stringify({ type: "app-host-connect", clientId, portId }));
  await waitForMessage(second, (message) => message.type === "app-host-port-connected");
  assert.equal(relays.length, 1);
});

test("replaces an overlapping socket for the same browser client before broadcasts", async (t) => {
  const server = http.createServer();
  const hub = createWsHub(server, {
    createAppHostRelay() {},
    handleNotificationEvent() {},
    isAuthed: () => true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const first = new WebSocket(url);
  sockets.push(first);
  await waitForOpen(first);
  first.send(hello("same-client"));
  await waitForMessage(first, (message) => message.type === "hello-ack");

  const firstClosed = waitForClose(first);
  const second = new WebSocket(url);
  sockets.push(second);
  await waitForOpen(second);
  second.send(hello("same-client"));
  await waitForMessage(second, (message) => message.type === "hello-ack");
  await firstClosed;

  const broadcast = waitForMessage(second, (message) => message.type === "state-update");
  assert.equal(hub.broadcast({ type: "state-update" }), 1);
  await broadcast;
  assert.equal(hub.clients.size, 1);
});
