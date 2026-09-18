const assert = require("node:assert/strict");
const test = require("node:test");
const { Readable } = require("node:stream");

const { MOBILE_CONTRACT_VERSION } = require("../../shared/mobile-contract/dist/index.js");
const { createMobileApiService } = require("../runtime/http/mobile-api.cjs");

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = String(body); },
  };
}

function request(method = "GET", version = MOBILE_CONTRACT_VERSION) {
  return { method, headers: { "x-opencodex-mobile-contract": String(version) } };
}

function jsonRequest(path, body, requestId = "msg_test", origin = "http://localhost") {
  const req = Readable.from([Buffer.from(JSON.stringify(body), "utf-8")]);
  req.method = "POST";
  req.url = path;
  req.headers = {
    host: "localhost",
    origin,
    "content-type": "application/json",
    "x-opencodex-mobile-contract": String(MOBILE_CONTRACT_VERSION),
    "x-request-id": requestId,
  };
  return req;
}

test("mobile bootstrap exposes only implemented capabilities", () => {
  const service = createMobileApiService({
    instanceId: "instance_test",
    getOfficialBundle: () => ({ version: "26.901.51231" }),
    now: () => Date.UTC(2026, 8, 6),
  });
  const res = responseRecorder();
  service.handle(
    request(),
    res,
    new URL("http://localhost/api/mobile/bootstrap"),
    { authenticated: true, expiresAtMs: Date.UTC(2026, 8, 6, 1) }
  );
  const body = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(body.contractVersion, MOBILE_CONTRACT_VERSION);
  assert.equal(body.serverInstanceId, "instance_test");
  assert.equal(body.runtimeVersion, "26.901.51231");
  assert.deepEqual(body.capabilities, { attachments: false, chat: false, diagnostics: true, projects: false, streaming: false });
  assert.match(res.headers["x-request-id"], /^req_[a-f0-9]+$/);
});

test("mobile API rejects stale contracts and unknown routes with an error envelope", () => {
  const service = createMobileApiService({ instanceId: "instance_test" });
  const stale = responseRecorder();
  service.handle(request("GET", 0), stale, new URL("http://localhost/api/mobile/bootstrap"), { authenticated: true });
  assert.equal(stale.status, 426);
  assert.equal(JSON.parse(stale.body).error.code, "client_upgrade_required");

  const missing = responseRecorder();
  service.handle(request(), missing, new URL("http://localhost/api/mobile/unknown"), { authenticated: true });
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.body).error.code, "invalid_request");
});

test("mobile unauthorized response never returns a legacy string error", () => {
  const service = createMobileApiService({ instanceId: "instance_test" });
  const res = responseRecorder();
  service.sendUnauthorized(request(), res);
  const body = JSON.parse(res.body);
  assert.equal(res.status, 401);
  assert.equal(body.error.code, "not_authenticated");
  assert.equal(typeof body.error.requestId, "string");
});

test("mobile attachment preview accepts direct browser resource requests without contract headers", async () => {
  const calls = [];
  const service = createMobileApiService({
    instanceId: "instance_test",
    serveMobileFile(pathname, res) {
      calls.push(pathname);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("preview");
    },
  });
  const response = responseRecorder();
  await service.handle({ method: "GET", headers: {} }, response, new URL("http://localhost/api/mobile/files/token/file.txt"), { authenticated: true });
  assert.equal(response.status, 200);
  assert.equal(response.body, "preview");
  assert.deepEqual(calls, ["/api/local-file/token/file.txt"]);
});

test("mobile API exposes thread history and accepts an idempotent message request", async () => {
  const calls = [];
  const domain = {
    async readThread(threadId) { calls.push(["read", threadId]); return { data: { id: threadId, messages: [] } }; },
    async startTurn(input) { calls.push(["start", input]); return { ...input, turnId: "turn-one", status: "streaming" }; },
  };
  const service = createMobileApiService({ instanceId: "instance_test", domain });
  const history = responseRecorder();
  await service.handle(request(), history, new URL("http://localhost/api/mobile/threads/thread-one"), { authenticated: true });
  assert.equal(history.status, 200);
  assert.equal(JSON.parse(history.body).data.id, "thread-one");

  const message = responseRecorder();
  const req = jsonRequest("/api/mobile/threads/thread-one/messages", { text: "你是谁", model: "gpt-test", reasoningEffort: "high" });
  await service.handle(req, message, new URL("http://localhost/api/mobile/threads/thread-one/messages"), { authenticated: true });
  assert.equal(message.status, 202);
  assert.equal(JSON.parse(message.body).turnId, "turn-one");
  assert.equal(calls[1][1].requestId, "msg_test");
});

test("mobile mutation API rejects cross-origin and missing request ids", async () => {
  const service = createMobileApiService({ instanceId: "instance_test", domain: { startTurn: async () => ({}) } });
  const crossOrigin = responseRecorder();
  const crossOriginReq = jsonRequest("/api/mobile/threads/thread-one/messages", { text: "x" }, "msg_cross", "https://attacker.example");
  await service.handle(crossOriginReq, crossOrigin, new URL("http://localhost/api/mobile/threads/thread-one/messages"), { authenticated: true });
  assert.equal(crossOrigin.status, 403);

  const missing = responseRecorder();
  const missingReq = jsonRequest("/api/mobile/threads/thread-one/messages", { text: "x" }, "");
  await service.handle(missingReq, missing, new URL("http://localhost/api/mobile/threads/thread-one/messages"), { authenticated: true });
  assert.equal(missing.status, 400);
  assert.equal(JSON.parse(missing.body).error.code, "invalid_request");
});
