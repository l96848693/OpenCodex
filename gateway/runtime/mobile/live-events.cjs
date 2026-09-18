const { MOBILE_CONTRACT_VERSION } = require("../../../shared/mobile-contract/dist/index.js");

const TURN_STATE_BY_METHOD = new Map([
  ["turn/started", "streaming"],
  ["turn/completed", "completed"],
  ["turn/interrupted", "cancelled"],
  ["turn/failed", "failed"],
]);

const DELTA_KIND_BY_METHOD = new Map([
  ["item/agentMessage/delta", "message"],
  ["item/reasoning/summaryTextDelta", "reasoning"],
  ["item/plan/delta", "reasoning"],
]);

function boundedString(value, maxLength) {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function firstString(...values) {
  return values.map((value) => boundedString(value, 200)).find(Boolean) || "";
}

function unwrapNotification(message) {
  let current = message;
  // 部分 App Server 版本會用 notification wrapper 包住真正通知；最多拆兩層，避免
  // 異常輸入造成遞迴或將非協議資料誤當成事件。
  for (let depth = 0; depth < 2; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const params = current.params && typeof current.params === "object" ? current.params : null;
    if (current.method === "notification" && typeof params?.method === "string") {
      current = params;
      continue;
    }
    if (params?.notification && typeof params.notification === "object" && typeof params.notification.method === "string") {
      current = params.notification;
      continue;
    }
    break;
  }
  return current;
}

function notificationIds(params) {
  return {
    threadId: firstString(
      params?.threadId,
      params?.thread_id,
      params?.thread?.id,
      params?.turn?.threadId,
      params?.turn?.thread_id,
      params?.item?.threadId,
      params?.item?.thread_id,
    ),
    turnId: firstString(
      params?.turnId,
      params?.turn_id,
      params?.turn?.id,
      params?.item?.turnId,
      params?.item?.turn_id,
    ),
    itemId: firstString(
      params?.itemId,
      params?.item_id,
      params?.item?.id,
    ),
  };
}

/** 將 App Server 通知收窄成 Mobile 契約，唔會外洩原始 IPC 或私有 reasoning。 */
function normalizeMobileLiveNotification(message) {
  const unwrapped = unwrapNotification(message);
  if (!unwrapped || typeof unwrapped !== "object") return null;
  const method = boundedString(unwrapped.method, 120);
  const params = unwrapped.params && typeof unwrapped.params === "object" ? unwrapped.params : {};
  const { threadId, turnId, itemId } = notificationIds(params);
  if (!threadId || !turnId) return null;

  const turnStatus = TURN_STATE_BY_METHOD.get(method);
  if (turnStatus) {
    return {
      type: "thread.turn.state",
      threadId,
      payload: { turnId, status: turnStatus },
    };
  }

  const kind = DELTA_KIND_BY_METHOD.get(method);
  const delta = boundedString(params.delta, 32_000);
  if (!kind || !itemId || !delta) return null;
  const phase = firstString(params.phase, params.item?.phase);
  return {
    type: "thread.message.delta",
    threadId,
    payload: { turnId, itemId, kind, delta, ...(phase ? { phase } : {}) },
  };
}

/** 將可見對話增量發送畀 Mobile socket；序號用嚟偵測休眠／重連期間嘅缺口。 */
function bindMobileLiveEvents({ transport, publish, sequenceRef } = {}) {
  const counter = sequenceRef && typeof sequenceRef === "object" ? sequenceRef : { value: 0 };
  if (typeof transport?.observeNotifications !== "function" || typeof publish !== "function") return () => {};
  return transport.observeNotifications((message) => {
    const normalized = normalizeMobileLiveNotification(message);
    if (!normalized) return;
    counter.value += 1;
    publish({ version: MOBILE_CONTRACT_VERSION, sequence: counter.value, ...normalized });
  });
}

module.exports = { bindMobileLiveEvents, normalizeMobileLiveNotification };
