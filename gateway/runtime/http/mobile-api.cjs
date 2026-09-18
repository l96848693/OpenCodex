const crypto = require("crypto");
const {
  MOBILE_CONTRACT_VERSION,
  MOBILE_MIN_CLIENT_VERSION,
  mobileError,
} = require("../../../shared/mobile-contract/dist/index.js");
const { isRequestBodyTooLargeError, readBody, sendJson } = require("./http-utils.cjs");
const { CODEX_WEB_PICKED_FILES_MAX_TOTAL_BYTES } = require("../core/config.cjs");

const MOBILE_API_PREFIX = "/api/mobile";
const MOBILE_API_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});
const MOBILE_JSON_BODY_MAX_BYTES = 256 * 1024;
const MOBILE_ATTACHMENT_BODY_MAX_BYTES = Math.ceil((CODEX_WEB_PICKED_FILES_MAX_TOTAL_BYTES * 4) / 3) + 2 * 1024 * 1024;

function requestId(req) {
  const supplied = String(req.headers?.["x-request-id"] || "").trim();
  return supplied && /^[a-zA-Z0-9_-]{1,96}$/.test(supplied) ? supplied : `req_${crypto.randomUUID().replace(/-/g, "")}`;
}

function sendMobileError(res, status, code, message, id, retryable = false, retryAfterMs) {
  return sendJson(res, status, mobileError(code, message, id, retryable, retryAfterMs), MOBILE_API_HEADERS);
}

function sameOriginRequest(req) {
  const origin = String(req.headers?.origin || "").trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === String(req.headers?.host || "");
  } catch {
    return false;
  }
}

async function readJsonBody(req, maxBytes = MOBILE_JSON_BODY_MAX_BYTES) {
  const raw = await readBody(req, { maxBytes });
  const value = JSON.parse(raw || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("JSON body must be an object");
  return value;
}

function clientRequestId(req) {
  const supplied = String(req.headers?.["x-request-id"] || "").trim();
  return /^[a-zA-Z0-9_-]{1,96}$/.test(supplied) ? supplied : "";
}

function createMobileApiService(options = {}) {
  const getOfficialBundle = options.getOfficialBundle || (() => null);
  const domain = options.domain || null;
  const attachments = options.attachments || null;
  const serveMobileFile = options.serveMobileFile || null;
  const instanceId = String(options.instanceId || "");
  const now = options.now || (() => Date.now());
  const lease = options.lease || null;
  const appServer = options.appServer || null;
  const observeThread = typeof options.observeThread === "function" ? options.observeThread : () => {};

  function isMobileApiPath(pathname) {
    return pathname === MOBILE_API_PREFIX || pathname.startsWith(`${MOBILE_API_PREFIX}/`);
  }

  function clientContractVersion(req) {
    return Number(req.headers?.["x-opencodex-mobile-contract"]);
  }

  function clientId(req, body = {}) {
    return String(body.clientId || req.headers?.["x-opencodex-client-id"] || req.headers?.["x-request-id"] || "").slice(0, 160);
  }

  function sendUnauthorized(req, res) {
    return sendMobileError(res, 401, "not_authenticated", "登录已失效，请重新登录。", requestId(req));
  }

  async function handle(req, res, url, auth) {
    const id = requestId(req);
    // 預覽 URL 由瀏覽器資源元素直接請求，唔會帶契約 header；opaque token 已經係第二層授權，先處理呢條唯讀路由。
    const mobileFileMatch = url.pathname.match(/^\/api\/mobile\/files\/(.+)$/);
    if (mobileFileMatch && req.method === "GET" && serveMobileFile) {
      return serveMobileFile("/api/local-file/" + mobileFileMatch[1], res);
    }
    const clientVersion = clientContractVersion(req);
    if (
      !Number.isInteger(clientVersion) ||
      clientVersion < MOBILE_MIN_CLIENT_VERSION ||
      clientVersion > MOBILE_CONTRACT_VERSION
    ) {
      return sendMobileError(
        res,
        426,
        "client_upgrade_required",
        "移动页面与 Gateway 契约不兼容，请刷新页面。",
        id
      );
    }
    try {
      if (url.pathname === `${MOBILE_API_PREFIX}/bootstrap`) {
        if (req.method !== "GET") return sendMobileError(res, 405, "invalid_request", "请求方法不支持。", id);
        const bundle = getOfficialBundle() || {};
        const sessionExpiresAt = auth?.expiresAtMs ? new Date(auth.expiresAtMs).toISOString() : null;
        return sendJson(
          res,
          200,
          {
            contractVersion: MOBILE_CONTRACT_VERSION,
            minClientVersion: MOBILE_MIN_CLIENT_VERSION,
            serverInstanceId: instanceId,
            serverTime: new Date(now()).toISOString(),
            sessionExpiresAt,
            runtimeVersion: String(bundle.version || "unknown"),
            capabilities: {
              attachments: Boolean(attachments),
              chat: Boolean(domain),
              diagnostics: true,
              projects: Boolean(domain),
              streaming: Boolean(domain),
            },
          },
          { ...MOBILE_API_HEADERS, "x-request-id": id }
        );
      }
      if (url.pathname === `${MOBILE_API_PREFIX}/app-server/status` && req.method === "GET") {
        const status = appServer?.status?.() || { state: "unavailable", pid: null, retryCount: 0, retryAfterMs: 0, logs: [] };
        return sendJson(res, 200, { data: status }, { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      if (url.pathname === `${MOBILE_API_PREFIX}/app-server/logs` && req.method === "GET") {
        const limit = Math.min(10, Math.max(1, Number(url.searchParams.get("limit") || 10)));
        const status = appServer?.status?.() || { logs: [] };
        return sendJson(res, 200, { data: (status.logs || []).slice(0, limit) }, { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      if (url.pathname === `${MOBILE_API_PREFIX}/app-server/restart` && req.method === "POST") {
        const restart = appServer?.restart?.();
        if (!restart?.ok) return sendMobileError(res, 409, "app_server_restarting", "App server restarting, please wait 30s.", id, true, restart?.retryAfterMs || 30_000);
        return sendJson(res, 202, { status: "restarting", retryAfterMs: restart.retryAfterMs || 30_000 }, { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      const leaseMatch = url.pathname.match(/^\/api\/mobile\/sessions\/([a-zA-Z0-9_-]+)\/lease\/(acquire|heartbeat|release)$/);
      if (leaseMatch && req.method === "POST") {
        if (!sameOriginRequest(req)) return sendMobileError(res, 403, "invalid_request", "请求来源不受信任。", id);
        if (!lease) return sendMobileError(res, 503, "app_server_unavailable", "Gateway lease service unavailable.", id, true);
        const body = await readJsonBody(req);
        const sessionId = leaseMatch[1]; const owner = clientId(req, body);
        const result = leaseMatch[2] === "acquire" ? lease.acquire(sessionId, owner) : leaseMatch[2] === "heartbeat" ? lease.heartbeat(sessionId, owner) : lease.release(sessionId, owner);
        if (!result.ok) return sendMobileError(res, 409, result.code, result.code === "session_lease_conflict" ? "This session is controlled by another browser." : "Invalid lease request.", id, result.code !== "session_lease_conflict");
        return sendJson(res, 200, result, { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      if (url.pathname === `${MOBILE_API_PREFIX}/projects`) {
        if (req.method !== "GET") return sendMobileError(res, 405, "invalid_request", "请求方法不支持。", id);
        return sendJson(res, 200, await domain.listProjects(), { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      if (url.pathname === `${MOBILE_API_PREFIX}/attachments` && req.method === "POST") {
        if (!attachments) return sendMobileError(res, 503, "attachment_rejected", "附件服务暂时不可用。", id, true);
        if (!sameOriginRequest(req)) return sendMobileError(res, 403, "invalid_request", "请求来源不受信任。", id);
        const suppliedId = clientRequestId(req);
        if (!suppliedId) return sendMobileError(res, 400, "invalid_request", "缺少有效 requestId。", id);
        const body = await readJsonBody(req, MOBILE_ATTACHMENT_BODY_MAX_BYTES);
        return sendJson(res, 201, attachments.upload(body.files), { ...MOBILE_API_HEADERS, "x-request-id": suppliedId });
      }
      const threadsMatch = url.pathname.match(/^\/api\/mobile\/projects\/([a-zA-Z0-9_-]+)\/threads$/);
      if (threadsMatch) {
        if (req.method === "GET") {
          return sendJson(res, 200, await domain.listProjectThreads(threadsMatch[1]), { ...MOBILE_API_HEADERS, "x-request-id": id });
        }
        if (req.method === "POST") {
          if (!sameOriginRequest(req)) return sendMobileError(res, 403, "invalid_request", "请求来源不受信任。", id);
          const suppliedId = clientRequestId(req);
          if (!suppliedId) return sendMobileError(res, 400, "invalid_request", "缺少有效 requestId。", id);
          const body = await readJsonBody(req);
          return sendJson(res, 201, await domain.createThread({ projectId: threadsMatch[1], requestId: suppliedId, model: body.model }), { ...MOBILE_API_HEADERS, "x-request-id": suppliedId });
        }
        return sendMobileError(res, 405, "invalid_request", "请求方法不支持。", id);
      }
      const threadMatch = url.pathname.match(/^\/api\/mobile\/threads\/([a-zA-Z0-9_-]+)$/);
      if (threadMatch && req.method === "GET") {
        // Mobile 进入会话即加入官方桌面 stream follower，首个 snapshot 才能反映跨进程活动回合。
        observeThread(threadMatch[1], "local");
        const limit = Math.min(5, Math.max(1, Number(url.searchParams.get("limit") || 5)));
        return sendJson(res, 200, await domain.readThread(threadMatch[1], { cursor: url.searchParams.get("cursor") || null, limit }), { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      const itemMatch = url.pathname.match(/^\/api\/mobile\/threads\/([a-zA-Z0-9_-]+)\/turns\/([a-zA-Z0-9_-]+)\/items$/);
      if (itemMatch && req.method === "GET") {
        return sendJson(res, 200, await domain.loadTurnItems(itemMatch[1], itemMatch[2], url.searchParams.get("cursor") || null, url.searchParams.get("itemId") || ""), { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      const messageMatch = url.pathname.match(/^\/api\/mobile\/threads\/([a-zA-Z0-9_-]+)\/messages$/);
      if (messageMatch && req.method === "POST") {
        if (!sameOriginRequest(req)) return sendMobileError(res, 403, "invalid_request", "请求来源不受信任。", id);
        const suppliedId = clientRequestId(req);
        if (!suppliedId) return sendMobileError(res, 400, "invalid_request", "缺少有效 requestId。", id);
        const body = await readJsonBody(req);
        if (lease && !lease.owns(messageMatch[1], clientId(req, body))) return sendMobileError(res, 409, "session_lease_conflict", "This session is controlled by another browser.", suppliedId);
        const result = await domain.startTurn({
          threadId: messageMatch[1],
          text: body.text,
          requestId: suppliedId,
          model: body.model,
          reasoningEffort: body.reasoningEffort,
          attachments: attachments ? attachments.resolve(body.attachmentIds || []) : [],
        });
        return sendJson(res, 202, result, { ...MOBILE_API_HEADERS, "x-request-id": suppliedId });
      }
      const cancelMatch = url.pathname.match(/^\/api\/mobile\/turns\/([a-zA-Z0-9_-]+)\/cancel$/);
      if (cancelMatch && req.method === "POST") {
        if (!sameOriginRequest(req)) return sendMobileError(res, 403, "invalid_request", "请求来源不受信任。", id);
        const suppliedId = clientRequestId(req);
        if (!suppliedId) return sendMobileError(res, 400, "invalid_request", "缺少有效 requestId。", id);
        const body = await readJsonBody(req);
        const threadId = String(body.threadId || "");
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(threadId)) return sendMobileError(res, 400, "invalid_request", "threadId 无效。", suppliedId);
        const result = await domain.interruptTurn({ threadId, turnId: cancelMatch[1], requestId: suppliedId });
        return sendJson(res, 200, result, { ...MOBILE_API_HEADERS, "x-request-id": suppliedId });
      }
      if (url.pathname === `${MOBILE_API_PREFIX}/models` && req.method === "GET") {
        return sendJson(res, 200, await domain.listModels(), { ...MOBILE_API_HEADERS, "x-request-id": id });
      }
      return sendMobileError(res, 404, "invalid_request", "移动端接口不存在。", id);
    } catch (error) {
      const malformedBody = error instanceof SyntaxError || error instanceof TypeError;
      const code = malformedBody
        ? "invalid_request"
        : ["attachment_rejected", "app_server_restarting", "app_server_unavailable", "invalid_request", "queue_expired", "session_expired", "session_state_syncing", "session_lease_conflict", "session_lease_expired", "session_read_timeout", "session_payload_too_large", "turn_conflict", "turn_interrupt_pending"].includes(error?.code)
        ? error.code
        : error?.category === "timeout"
          ? "queue_expired"
          : "unknown_error";
      const status = isRequestBodyTooLargeError(error)
        ? 413
        : Number(error?.status) || (code === "invalid_request" || code === "attachment_rejected" ? 400 : code === "turn_conflict" || code === "session_lease_conflict" || code === "session_lease_expired" || code === "turn_interrupt_pending" ? 409 : code === "session_read_timeout" ? 408 : code === "session_payload_too_large" ? 413 : ["session_expired", "app_server_restarting", "app_server_unavailable", "session_state_syncing"].includes(code) ? 503 : 500);
      const message = malformedBody
        ? "请求内容格式无效。"
        : code === "queue_expired" ? "Queue request expired, please retry." : code === "session_read_timeout" ? "Session history loading timed out, please retry." : code === "session_payload_too_large" ? "Session history is too large, please load fewer turns." : code === "app_server_unavailable" ? "App server unavailable, please restart manually." : code === "app_server_restarting" ? "App server restarting, please wait 30s." : code === "session_state_syncing" ? "Session state syncing, please wait 5s." : code === "turn_interrupt_pending" ? "Stopping current task, please wait 5s." : String(error?.message || "Unexpected gateway error.");
      return sendMobileError(res, status, code, message, id, error?.retryable === true || code === "session_expired" || code === "unknown_error", error?.retryAfterMs);
    }
  }

  return { handle, isMobileApiPath, sendUnauthorized };
}

module.exports = { MOBILE_API_HEADERS, MOBILE_API_PREFIX, MOBILE_JSON_BODY_MAX_BYTES, createMobileApiService };
