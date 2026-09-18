const assert = require("node:assert/strict");
const test = require("node:test");
const { createWebLeaseManager } = require("../runtime/mobile/web-lease.cjs");

test("web lease expires after TTL and can be acquired by another browser", () => {
  let now = 0;
  const expired = [];
  const manager = createWebLeaseManager({ now: () => now, ttlMs: 300_000, onExpired: (event) => expired.push(event) });
  assert.equal(manager.acquire("session-a", "browser-a").ok, true);
  assert.equal(manager.acquire("session-a", "browser-b").code, "session_lease_conflict");
  now = 300_001;
  assert.equal(manager.acquire("session-a", "browser-b").ok, true);
  assert.equal(expired.length, 1);
  manager.dispose();
});
