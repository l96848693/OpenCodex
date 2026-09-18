const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createMobileAssetService } = require("../runtime/http/mobile-assets.cjs");

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); },
  };
}

test("mobile assets keep SPA fallback separate from official renderer", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-mobile-assets-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "index.html"), "<main>mobile</main>");
  fs.writeFileSync(path.join(root, "assets", "app-123.js"), "console.log('mobile')");
  const service = createMobileAssetService({ distDir: root, enabled: true });

  assert.equal(service.isMobileRequest({ method: "GET" }, "/mobile/projects"), true);
  assert.equal(service.isMobileRequest({ method: "POST" }, "/mobile/projects"), false);
  assert.equal(service.fileForPath("/mobile/projects"), path.join(root, "index.html"));

  const page = responseRecorder();
  service.serve({ method: "GET", headers: {} }, page, "/mobile/projects");
  assert.equal(page.status, 200);
  assert.equal(page.body.toString(), "<main>mobile</main>");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);

  const asset = responseRecorder();
  service.serve({ method: "GET", headers: {} }, asset, "/mobile/assets/app-123.js");
  assert.equal(asset.status, 200);
  assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
});

test("mobile asset mapper rejects traversal outside its dist directory", () => {
  const service = createMobileAssetService({ distDir: path.resolve("mobile-dist-test"), enabled: true });
  assert.equal(service.fileForPath("/mobile/../../config.yaml"), null);
});
