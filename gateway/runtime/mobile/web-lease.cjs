const WEB_LEASE_TTL_MS = 5 * 60_000;
const WEB_HEARTBEAT_INTERVAL_MS = 30_000;

function createWebLeaseManager({ now = () => Date.now(), ttlMs = WEB_LEASE_TTL_MS, onExpired } = {}) {
  const leases = new Map();
  const timer = setInterval(() => expire(), Math.min(WEB_HEARTBEAT_INTERVAL_MS, Math.max(1_000, ttlMs / 2)));
  timer.unref?.();

  function key(sessionId) { return String(sessionId || ""); }
  function expire() {
    const current = now();
    for (const [sessionId, lease] of leases) {
      if (current - lease.lastSeen < ttlMs) continue;
      leases.delete(sessionId);
      try { onExpired?.({ sessionId, clientId: lease.clientId, expiredAt: current }); } catch {}
    }
  }
  function acquire(sessionId, clientId) {
    expire();
    const id = key(sessionId); const owner = String(clientId || "");
    if (!id || !owner) return { ok: false, code: "invalid_request" };
    const current = leases.get(id);
    if (current && current.clientId !== owner) return { ok: false, code: "session_lease_conflict", lease: { lastSeen: current.lastSeen } };
    const lease = { clientId: owner, acquiredAt: current?.acquiredAt || now(), lastSeen: now() };
    leases.set(id, lease);
    return { ok: true, lease: { ...lease, expiresAt: lease.lastSeen + ttlMs } };
  }
  function heartbeat(sessionId, clientId) {
    const id = key(sessionId); const owner = String(clientId || ""); const current = leases.get(id);
    if (!current) return acquire(id, owner);
    if (current.clientId !== owner) return { ok: false, code: "session_lease_conflict" };
    current.lastSeen = now();
    return { ok: true, lease: { ...current, expiresAt: current.lastSeen + ttlMs } };
  }
  function release(sessionId, clientId) {
    const id = key(sessionId); const current = leases.get(id);
    if (current && current.clientId === String(clientId || "")) leases.delete(id);
    return { ok: true };
  }
  function owns(sessionId, clientId) {
    expire(); const current = leases.get(key(sessionId));
    return !current || current.clientId === String(clientId || "");
  }
  function snapshot() { expire(); return new Map(Array.from(leases, ([id, lease]) => [id, { ...lease }])); }
  function dispose() { clearInterval(timer); leases.clear(); }
  return { acquire, heartbeat, release, owns, snapshot, dispose, ttlMs };
}

module.exports = { WEB_HEARTBEAT_INTERVAL_MS, WEB_LEASE_TTL_MS, createWebLeaseManager };
