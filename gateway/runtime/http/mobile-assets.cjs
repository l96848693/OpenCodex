const fs = require("fs");
const path = require("path");
const { PROJECT_ROOT, isWithinRoot, mimeType } = require("../core/config.cjs");
const { gzipIfUseful, send } = require("./http-utils.cjs");

const MOBILE_PREFIX = "/mobile";
const MOBILE_SECURITY_HEADERS = Object.freeze({
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

function createMobileAssetService(options = {}) {
  const distDir = path.resolve(options.distDir || path.join(PROJECT_ROOT, "gateway", "dist", "mobile"));
  const enabled = options.enabled ?? process.env.OPENCODEX_MOBILE_ENABLED !== "0";

  function isMobileRequest(req, pathname) {
    if (!enabled || (req.method !== "GET" && req.method !== "HEAD")) return false;
    return pathname === MOBILE_PREFIX || pathname.startsWith(`${MOBILE_PREFIX}/`);
  }

  function fileForPath(pathname) {
    const relative = pathname.slice(MOBILE_PREFIX.length).replace(/^\/+/, "");
    if (!relative || !path.extname(relative)) return path.join(distDir, "index.html");
    const candidate = path.resolve(distDir, relative);
    return isWithinRoot(candidate, distDir) ? candidate : null;
  }

  function serve(req, res, pathname) {
    const file = fileForPath(pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(
        res,
        404,
        { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...MOBILE_SECURITY_HEADERS },
        req.method === "HEAD" ? "" : "Mobile frontend is not built."
      );
    }
    const isHtml = path.basename(file).toLowerCase() === "index.html";
    const headers = {
      "content-type": mimeType(file),
      "cache-control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
      ...MOBILE_SECURITY_HEADERS,
    };
    if (req.method === "HEAD") return send(res, 200, headers, "");
    const response = gzipIfUseful(req, headers, fs.readFileSync(file));
    return send(res, 200, response.headers, response.body);
  }

  return { distDir, enabled, fileForPath, isMobileRequest, serve };
}

module.exports = { MOBILE_PREFIX, MOBILE_SECURITY_HEADERS, createMobileAssetService };
