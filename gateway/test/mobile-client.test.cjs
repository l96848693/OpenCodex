const assert = require("node:assert/strict");
const test = require("node:test");

const { MobileSessionStore, reduceConnectionState, reduceTurnState, TtlFifoQueue } = require(
  "../../shared/mobile-client/dist/index.js"
);

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(delayMs) {
      now += delayMs;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    timerCount: () => timers.size,
  };
}

function fakeSocketFactory() {
  const sockets = [];
  const factory = () => {
    const socket = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      sent: [],
      send(value) { this.sent.push(JSON.parse(value)); },
      close() { this.readyState = 3; this.onclose?.(); },
      open() { this.readyState = 1; this.onopen?.(); },
      message(value) { this.onmessage?.({ data: JSON.stringify(value) }); },
      serverClose() { this.readyState = 3; this.onclose?.(); },
    };
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
}

test("mobile connection and turn state machines remain independent", () => {
  assert.equal(reduceConnectionState("idle", "open"), "connecting");
  assert.equal(reduceConnectionState("connecting", "connected"), "ready");
  assert.equal(reduceConnectionState("ready", "closed"), "reconnecting");
  assert.equal(reduceConnectionState("reconnecting", "ttl_expired"), "expired");
  assert.equal(reduceTurnState("idle", "send"), "submitting");
  assert.equal(reduceTurnState("submitting", "accepted"), "streaming");
  assert.equal(reduceTurnState("streaming", "cancel"), "cancelling");
  assert.equal(reduceTurnState("cancelling", "final"), "completed");
  assert.throws(() => reduceConnectionState("idle", "connected"), /Invalid mobile connection transition/);
});

test("mobile session becomes ready only after the versioned hello ack", () => {
  const clock = fakeClock();
  const sockets = fakeSocketFactory();
  const store = new MobileSessionStore({
    url: "ws://gateway/ws",
    clientId: "mobile-one",
    gatewayInstanceId: "instance-one",
    clock,
    socketFactory: sockets.factory,
  });
  store.open();
  assert.equal(store.getSnapshot().status, "connecting");
  sockets.sockets[0].open();
  assert.deepEqual(sockets.sockets[0].sent[0], {
    type: "mobile:hello",
    clientId: "mobile-one",
    gatewayInstanceId: "instance-one",
  });
  sockets.sockets[0].message({ type: "mobile:hello-ack", gatewayInstanceId: "instance-one" });
  assert.equal(store.getSnapshot().status, "ready");
  assert.equal(clock.timerCount(), 0);
  store.dispose();
});

test("mobile session delivers only versioned live events to subscribers", () => {
  const clock = fakeClock();
  const sockets = fakeSocketFactory();
  const store = new MobileSessionStore({
    url: "ws://gateway/ws",
    clientId: "mobile-live",
    gatewayInstanceId: "instance-live",
    clock,
    socketFactory: sockets.factory,
  });
  const events = [];
  store.subscribeEvents((event) => events.push(event));
  store.open();
  sockets.sockets[0].open();
  sockets.sockets[0].message({ type: "mobile:hello-ack", gatewayInstanceId: "instance-live" });
  sockets.sockets[0].message({ type: "thread.message.delta", version: 99, sequence: 1, threadId: "ignored", payload: {} });
  sockets.sockets[0].message({
    type: "thread.message.delta",
    version: 1,
    sequence: 2,
    threadId: "thread-one",
    payload: { turnId: "turn-one", itemId: "item-one", kind: "message", delta: "实时内容" },
  });
  sockets.sockets[0].message({
    type: "thread.turn.state",
    version: 1,
    sequence: 4,
    threadId: "thread-one",
    payload: { turnId: "turn-one", status: "completed" },
  });
  sockets.sockets[0].message({
    type: "thread.turn.state",
    version: 1,
    sequence: 4,
    threadId: "thread-one",
    payload: { turnId: "turn-one", status: "completed" },
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].payload.delta, "实时内容");
  assert.equal(events[1].sequenceGap, true);
  store.dispose();
});

test("mobile session retries with a bound and expires after five minutes", () => {
  const clock = fakeClock();
  const sockets = fakeSocketFactory();
  const store = new MobileSessionStore({
    url: "ws://gateway/ws",
    clientId: "mobile-two",
    gatewayInstanceId: "instance-two",
    clock,
    socketFactory: sockets.factory,
    sessionTtlMs: 300_000,
  });
  store.open();
  sockets.sockets[0].open();
  sockets.sockets[0].message({ type: "mobile:hello-ack", gatewayInstanceId: "instance-two" });
  sockets.sockets[0].serverClose();
  assert.equal(store.getSnapshot().status, "reconnecting");
  clock.advance(500);
  assert.equal(sockets.sockets.length, 2);
  clock.advance(300_000);
  assert.equal(store.getSnapshot().status, "expired");
  assert.equal(clock.timerCount(), 0);
  store.dispose();
});

test("mobile FIFO expires while idle and clears its timer on dequeue", async () => {
  const clock = fakeClock();
  const queue = new TtlFifoQueue({ queueType: "message", ttlMs: 300_000, maxLength: 2, clock });
  const first = queue.enqueue("one");
  assert.equal(queue.dequeue(), "one");
  await first;
  assert.equal(clock.timerCount(), 0);

  const expired = queue.enqueue("two");
  clock.advance(300_000);
  await assert.rejects(expired, (error) => error.code === "queue_expired" && error.queueType === "message");
  assert.equal(queue.size, 0);
});

test("mobile FIFO is bounded and dispose rejects retained work", async () => {
  const clock = fakeClock();
  const queue = new TtlFifoQueue({ queueType: "attachment", ttlMs: 1_000, maxLength: 1, clock });
  const retained = queue.enqueue("one");
  await assert.rejects(queue.enqueue("two"), (error) => error.code === "queue_expired");
  queue.dispose();
  await assert.rejects(retained, /disposed/);
  assert.equal(clock.timerCount(), 0);
});
