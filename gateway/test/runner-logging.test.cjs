const assert = require("node:assert/strict");
const test = require("node:test");

const { logJsonLine, logLine, sanitizeLogText } = require("../runner/shared/logging.cjs");

test("runner text logs redact Windows absolute paths while keeping labels", () => {
  const lines = [];
  logLine((line) => lines.push(line), "official Electron source: app=C:\\Users\\young\\AppData\\Local\\Codex asar=C:\\Program Files\\Codex\\resources\\app.asar");
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /C:\\Users|C:\\Program Files/);
  assert.match(lines[0], /app=\[redacted-path\] asar=\[redacted-path\]/);
});

test("runner JSON logs redact path fields and URL credentials", () => {
  const lines = [];
  logJsonLine((line) => lines.push(line), "official Electron install scanned:", {
    installRoot: "C:\\Users\\young\\AppData\\Local\\Packages\\Codex",
    resourcesDir: "/home/young/.codex/resources",
    url: "https://example.test/?access_token=secret-value",
    platformHint: "win32",
  });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /C:\\Users|\/home\/young|secret-value/);
  assert.match(lines[0], /\"installRoot\":\"\[redacted-path\]\"/);
  assert.match(lines[0], /\"url\":\"https:\/\/example\.test\/\?access_token=\[redacted\]\"/);
  assert.match(lines[0], /\"platformHint\":\"win32\"/);
});

test("standalone log text sanitizer is stable for non-path messages", () => {
  assert.equal(sanitizeLogText("gateway ready"), "gateway ready");
});
