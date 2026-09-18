const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MOBILE_CONTRACT_VERSION,
  detectMobileCapabilities,
  isCompatibleContract,
  isMobileEventEnvelope,
} = require("../../shared/mobile-contract/dist/index.js");

test("mobile capability profile blocks only required browser features", () => {
  const supported = detectMobileCapabilities({
    AbortController: class {},
    ResizeObserver: class {},
    WebSocket: class {},
    CSS: { supports: () => true },
    visualViewport: {},
  });
  assert.equal(supported.compatible, true);
  assert.deepEqual(supported.blockingReasons, []);
  assert.deepEqual(supported.warnings, []);

  const degraded = detectMobileCapabilities({ AbortController: class {}, WebSocket: class {} });
  assert.equal(degraded.compatible, true);
  assert.equal(degraded.warnings.length, 3);

  const blocked = detectMobileCapabilities({});
  assert.equal(blocked.compatible, false);
  assert.equal(blocked.blockingReasons.length, 2);
});

test("mobile contract negotiates versions without guessing newer protocols", () => {
  assert.equal(isCompatibleContract(MOBILE_CONTRACT_VERSION, MOBILE_CONTRACT_VERSION), true);
  assert.equal(isCompatibleContract(0, MOBILE_CONTRACT_VERSION), false);
  assert.equal(isCompatibleContract(MOBILE_CONTRACT_VERSION, MOBILE_CONTRACT_VERSION + 1), false);
  assert.equal(isCompatibleContract(Number.NaN, MOBILE_CONTRACT_VERSION), false);
});

test("mobile event envelope rejects malformed sequence and missing payload", () => {
  assert.equal(isMobileEventEnvelope({ version: 1, sequence: 0, type: "session.ready", payload: {} }), true);
  assert.equal(isMobileEventEnvelope({ version: 1, sequence: -1, type: "session.ready", payload: {} }), false);
  assert.equal(isMobileEventEnvelope({ version: 1, sequence: 1, type: "" }), false);
  assert.equal(isMobileEventEnvelope(null), false);
});
