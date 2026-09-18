const net = require("node:net");

const IPC_FRAME_HEADER_BYTES = 4;
const IPC_MAX_FRAME_BYTES = 256 * 1024 * 1024;
const DEFAULT_HOST_ID = "local";
const DEFAULT_CLIENT_TYPE = "opencodex-readonly-observer";
const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 60_000;
const DEFAULT_MAX_KNOWN_THREADS = 512;
const DEFAULT_MAX_MOBILE_STREAM_STATES = 64;
const MOBILE_STREAM_TEXT_LIMIT = 32_000;
const MOBILE_STREAM_MAX_INITIAL_ITEMS = 32;

const STREAMING_STATUSES = new Set(["pending", "in_progress", "inprogress", "running", "started", "streaming", "active"]);
const TERMINAL_STATUSES = new Set(["completed", "complete", "succeeded", "success", "done", "failed", "failure", "error", "interrupted", "cancelled", "canceled", "stopped", "aborted"]);

function boundedStreamText(value) {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return text.length > MOBILE_STREAM_TEXT_LIMIT ? text.slice(0, MOBILE_STREAM_TEXT_LIMIT) : text;
}

function streamStatus(value) {
  const raw = value && typeof value === "object" ? value.type ?? value.status ?? value.state ?? value.value : value;
  const normalized = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (STREAMING_STATUSES.has(normalized)) return "streaming";
  if (normalized === "failed" || normalized === "failure" || normalized === "error") return "failed";
  if (normalized === "interrupted" || normalized === "cancelled" || normalized === "canceled" || normalized === "stopped" || normalized === "aborted") return "cancelled";
  if (normalized === "completed" || normalized === "complete" || normalized === "succeeded" || normalized === "success" || normalized === "done") return "completed";
  return "unknown";
}

function runtimeIsActive(value) {
  const raw = value && typeof value === "object"
    ? value.type ?? value.status ?? value.state ?? value.value
    : value;
  const normalized = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return STREAMING_STATUSES.has(normalized);
}

function streamId(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).slice(0, 200);
  if (!value || typeof value !== "object") return "";
  return String(value.id || value.turnId || value.turn_id || "").slice(0, 200);
}

function streamItemKind(item) {
  const type = String(item?.type || "").trim().toLowerCase();
  const phase = streamItemPhase(item);
  if (["usermessage", "user_message"].includes(type)) return "user";
  if (["agentmessage", "agent_message", "assistant-message", "assistant_message"].includes(type)) {
    return !phase || phase === "final" || phase === "final_answer" ? "message" : "reasoning";
  }
  if (["reasoning", "plan", "proposed-plan", "proposed_plan"].includes(type)) return "reasoning";
  if (["commandexecution", "filechange", "mcptoolcall", "dynamictoolcall", "websearch", "toolcall", "toolresult"].includes(type)) return "reasoning";
  return "";
}

function streamItemPhase(item) {
  const phase = typeof item?.phase === "string"
    ? item.phase.trim().toLowerCase()
    : typeof item?.metadata?.phase === "string"
      ? item.metadata.phase.trim().toLowerCase()
      : "";
  return phase || "";
}

function streamItemText(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.text === "string") return boundedStreamText(item.text);
  if (Array.isArray(item.summary)) return boundedStreamText(item.summary.map((part) => String(part || "")).filter(Boolean).join("\n"));
  if (Array.isArray(item.content)) {
    return boundedStreamText(item.content.map((part) => {
      if (typeof part === "string") return part;
      return ["text", "Text"].includes(String(part?.type || "")) ? String(part.text || "") : "";
    }).filter(Boolean).join("\n"));
  }
  return "";
}

function streamItemId(item, fallback) {
  return String(item?.id || item?.itemId || item?.item_id || fallback || "").slice(0, 200);
}

function turnLike(value, key = "") {
  if (!value || typeof value !== "object") return false;
  return Boolean(streamId(value) || value.turn_status || value.turnStatus || value.status || /^turn:/.test(key));
}

function projectTurn(value, index = 0, key = "") {
  if (!turnLike(value, key)) return null;
  const id = streamId(value) || (key.startsWith("turn:") ? key.slice(5) : `turn_${index}`);
  if (!id) return null;
  const items = Array.isArray(value.items)
    ? value.items
    : Array.isArray(value.outputItems)
      ? value.outputItems
      : Array.isArray(value.output_items)
        ? value.output_items
        : [];
  return {
    id,
    status: streamStatus(value.status ?? value.turn_status ?? value.turnStatus ?? value.state),
    startedAt: Number(value.turnStartedAtMs || value.turn_started_at_ms || value.createdAt || 0) || 0,
    items: items.map((item, itemIndex) => ({
      id: streamItemId(item, `item_${id}_${itemIndex}`),
      kind: streamItemKind(item),
      phase: streamItemPhase(item),
      text: streamItemText(item),
      index: itemIndex,
    })),
  };
}

function projectConversationState(state) {
  if (!state || typeof state !== "object") return { turns: [], activeTurnId: null, runtimeActive: false };
  const turns = [];
  const add = (value, index, key) => {
    const turn = projectTurn(value, index, key);
    if (!turn || turns.some((candidate) => candidate.id === turn.id)) return;
    turns.push(turn);
  };
  (Array.isArray(state.turns) ? state.turns : []).forEach((turn, index) => add(turn, index, ""));
  const entities = state.turnHistory?.history?.entitiesByKey;
  if (entities && typeof entities === "object") {
    Object.entries(entities).forEach(([key, value], index) => add(value, index, key));
  }
  const runtimeActive = runtimeIsActive(state.threadRuntimeStatus);
  let active = turns
    .filter((turn) => turn.status === "streaming")
    .sort((left, right) => (right.startedAt - left.startedAt) || turns.indexOf(right) - turns.indexOf(left))
    .at(0);
  // 官方偶尔会先把 turn entity 写成 stopped，再更新 threadRuntimeStatus。
  // runtime 仍是 active 时，不能将旧终态投影给 Mobile；取最新 turn 作为当前活动回合。
  if (!active && runtimeActive) {
    active = [...turns]
      .sort((left, right) => (right.startedAt - left.startedAt) || turns.indexOf(right) - turns.indexOf(left))
      .at(0);
  }
  return { turns, activeTurnId: active?.id || null, runtimeActive };
}

function decodeJsonPointer(value) {
  return String(value || "").replace(/~1/g, "/").replace(/~0/g, "~");
}

function patchTurnId(record, path) {
  const parts = String(path || "").split("/").slice(1).map(decodeJsonPointer);
  const entityKey = parts.find((part) => part.startsWith("turn:"));
  if (entityKey) return entityKey.slice(5);
  if (record.entityTurnIds && parts.includes("entitiesByKey")) {
    const entityIndex = parts.indexOf("entitiesByKey");
    const entityKeyValue = parts[entityIndex + 1];
    if (entityKeyValue && record.entityTurnIds.has(entityKeyValue)) return record.entityTurnIds.get(entityKeyValue);
  }
  if (parts[0] === "turns" && /^\d+$/.test(parts[1] || "")) return record.turnIndex[Number(parts[1])] || "";
  return "";
}

function upsertProjectedTurn(record, value, index, key) {
  const next = projectTurn(value, index, key);
  if (!next) return null;
  const previous = record.turns.get(next.id);
  record.turns.set(next.id, next);
  if (!record.turnIndex.includes(next.id) && Number.isInteger(index)) record.turnIndex[index] = next.id;
  return { previous, next };
}

function applyStreamPatch(record, patch) {
  if (!patch || typeof patch !== "object") return null;
  const parts = String(patch.path || "").split("/").slice(1).map(decodeJsonPointer);
  const turnId = patchTurnId(record, patch.path);
  if (!turnId) return null;
  let turn = record.turns.get(turnId);
  if (!turn && patch.value && typeof patch.value === "object") {
    const result = upsertProjectedTurn(record, patch.value, parts[0] === "turns" ? Number(parts[1]) : -1, `turn:${turnId}`);
    turn = result?.next || null;
  }
  if (!turn) return null;
  const itemIndex = parts.indexOf("items");
  if (itemIndex < 0) {
    if (parts.at(-1) === "status" || parts.at(-1) === "turn_status" || parts.at(-1) === "turnStatus" || parts.at(-1) === "state") {
      const previous = turn.status;
      turn.status = streamStatus(patch.value);
      return { turnId, previousStatus: previous, status: turn.status, item: null };
    }
    if (parts.length <= 1 && patch.value && typeof patch.value === "object") {
      const result = upsertProjectedTurn(record, patch.value, -1, `turn:${turnId}`);
      return result ? { turnId, previousStatus: result.previous?.status || "unknown", status: result.next.status, item: null } : null;
    }
    return null;
  }
  const rawItemIndex = parts[itemIndex + 1];
  const numericItemIndex = /^\d+$/.test(rawItemIndex || "") ? Number(rawItemIndex) : -1;
  const itemId = numericItemIndex >= 0 ? turn.items[numericItemIndex]?.id || `item_${turnId}_${numericItemIndex}` : rawItemIndex || "";
  let item = turn.items.find((candidate) => candidate.id === itemId);
  if (!item && patch.value && typeof patch.value === "object") {
    item = { id: itemId || streamItemId(patch.value, `item_${turnId}_${turn.items.length}`), kind: streamItemKind(patch.value), phase: streamItemPhase(patch.value), text: streamItemText(patch.value), index: turn.items.length };
    turn.items.push(item);
  }
  if (!item) return null;
  if (parts.length === itemIndex + 2 && patch.value && typeof patch.value === "object") {
    item.kind = streamItemKind(patch.value) || item.kind;
    item.phase = streamItemPhase(patch.value) || item.phase;
    item.text = streamItemText(patch.value);
  } else if (parts.at(-1) === "text") {
    item.text = boundedStreamText(patch.value);
  } else if (parts.at(-1) === "summary") {
    item.kind = "reasoning";
    item.text = Array.isArray(patch.value) ? boundedStreamText(patch.value.map((part) => String(part || "")).join("\n")) : boundedStreamText(patch.value);
  } else if (parts.at(-1) === "content") {
    item.text = streamItemText({ content: patch.value });
  }
  return { turnId, previousStatus: turn.status, status: turn.status, item };
}

function createOfficialMobileStreamProjector(options = {}) {
  const publish = typeof options.publish === "function" ? options.publish : () => {};
  const maxStates = Math.max(1, Number(options.maxStates) || DEFAULT_MAX_MOBILE_STREAM_STATES);
  const states = new Map();

  function keyFor(threadId, hostId) { return threadKey(threadId, hostId); }
  function getOrCreate(threadId, hostId) {
    const key = keyFor(threadId, hostId);
    let record = states.get(key);
    if (!record) {
      record = { threadId, hostId, revision: null, activeTurnId: null, runtimeActive: false, turns: new Map(), turnIndex: [], entityTurnIds: new Map(), emittedStatus: new Map(), emittedText: new Map() };
    }
    states.delete(key);
    states.set(key, record);
    while (states.size > maxStates) states.delete(states.keys().next().value);
    return record;
  }
  function eventState(record, turnId, status) {
    if (!turnId || !["streaming", "completed", "cancelled", "failed"].includes(status)) return;
    const previous = record.emittedStatus.get(turnId);
    if (previous === status) return;
    record.emittedStatus.set(turnId, status);
    publish({ type: "thread.turn.state", threadId: record.threadId, payload: { turnId, status } });
  }
  function eventDelta(record, turn, item) {
    if (!item?.id || !item.kind || !item.text) return;
    const cacheKey = `${turn.id}\u0000${item.id}`;
    const previous = record.emittedText.get(cacheKey) || "";
    let delta = item.text;
    if (item.text.startsWith(previous)) delta = item.text.slice(previous.length);
    else if (previous.startsWith(item.text)) return;
    else delta = item.text;
    record.emittedText.set(cacheKey, item.text);
    if (!delta) return;
    publish({ type: "thread.message.delta", threadId: record.threadId, payload: { turnId: turn.id, itemId: item.id, kind: item.kind, delta, ...(item.phase ? { phase: item.phase } : {}) } });
  }
  function consume(message) {
    const params = message?.params && typeof message.params === "object" ? message.params : {};
    const threadId = typeof params.conversationId === "string" ? params.conversationId : "";
    const hostId = typeof params.hostId === "string" && params.hostId ? params.hostId : DEFAULT_HOST_ID;
    const change = params.change && typeof params.change === "object" ? params.change : null;
    if (!threadId || !change) return;
    const record = getOrCreate(threadId, hostId);
    if (change.type === "snapshot") {
      const projected = projectConversationState(change.conversationState);
      const previousActive = record.activeTurnId;
      record.turns = new Map(projected.turns.map((turn) => [turn.id, turn]));
      record.turnIndex = projected.turns.map((turn) => turn.id);
      record.entityTurnIds = new Map();
      const entities = change.conversationState?.turnHistory?.history?.entitiesByKey;
      if (entities && typeof entities === "object") {
        Object.entries(entities).forEach(([key, value], index) => {
          const turn = projectTurn(value, index, key);
          if (turn) record.entityTurnIds.set(key, turn.id);
        });
      }
      record.revision = change.revision ?? null;
      record.activeTurnId = projected.activeTurnId;
      record.runtimeActive = projected.runtimeActive;
      if (record.activeTurnId) {
        eventState(record, record.activeTurnId, "streaming");
        const active = record.turns.get(record.activeTurnId);
        active?.items.slice(-MOBILE_STREAM_MAX_INITIAL_ITEMS).forEach((item) => eventDelta(record, active, item));
      } else if (previousActive) {
        const previousTurn = record.turns.get(previousActive);
        const terminal = previousTurn?.status;
        if (terminal && terminal !== "streaming") eventState(record, previousActive, terminal);
      }
      return;
    }
    if (change.type !== "patches" || record.revision !== change.baseRevision || !Array.isArray(change.patches)) return;
    const changed = [];
    for (const patch of change.patches) {
      const patchPath = String(patch?.path || "");
      if (patchPath === "/threadRuntimeStatus" || patchPath.startsWith("/threadRuntimeStatus/")) {
        record.runtimeActive = runtimeIsActive(patch.value);
      }
      const result = applyStreamPatch(record, patch);
      if (result) changed.push(result);
    }
    record.revision = change.revision ?? record.revision;
    const previousActive = record.activeTurnId;
    const active = [...record.turns.values()]
      .filter((turn) => turn.status === "streaming")
      .sort((left, right) => (right.startedAt - left.startedAt) || record.turnIndex.indexOf(right.id) - record.turnIndex.indexOf(left.id))
      .at(0);
    const effectiveActive = active || (record.runtimeActive
      ? [...record.turns.values()]
        .sort((left, right) => (right.startedAt - left.startedAt) || record.turnIndex.indexOf(right.id) - record.turnIndex.indexOf(left.id))
        .at(0)
      : null);
    record.activeTurnId = effectiveActive?.id || null;
    if (record.activeTurnId) eventState(record, record.activeTurnId, "streaming");
    for (const result of changed) {
      const effectiveStatus = record.runtimeActive && result.turnId === record.activeTurnId ? "streaming" : result.status;
      if (effectiveStatus && effectiveStatus !== "unknown" && effectiveStatus !== "streaming") eventState(record, result.turnId, effectiveStatus);
      if (result.item && effectiveStatus === "streaming") eventDelta(record, record.turns.get(result.turnId), result.item);
    }
    if (!record.activeTurnId && previousActive && !changed.some((result) => result.turnId === previousActive && result.status !== "streaming")) {
      const previousTurn = record.turns.get(previousActive);
      if (previousTurn?.status && previousTurn.status !== "unknown") eventState(record, previousActive, previousTurn.status);
    }
  }
  function forget(threadId, hostId = DEFAULT_HOST_ID) { states.delete(keyFor(threadId, hostId)); }
  function reset() { states.clear(); }
  return { consume, forget, reset, __test: { getStates: () => new Map(states), projectConversationState, applyStreamPatch } };
}

function threadKey(conversationId, hostId) {
  return `${hostId}\u0000${conversationId}`;
}

function encodeIpcFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(IPC_FRAME_HEADER_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function createIpcFrameParser(onMessage, onError) {
  const header = Buffer.alloc(IPC_FRAME_HEADER_BYTES);
  let headerOffset = 0;
  let body = null;
  let bodyOffset = 0;
  let failed = false;

  function fail(error) {
    failed = true;
    onError(error);
  }

  function consume(chunk) {
    if (failed || !chunk || chunk.length === 0) return;
    let chunkOffset = 0;
    while (chunkOffset < chunk.length) {
      if (!body) {
        const headerBytes = Math.min(IPC_FRAME_HEADER_BYTES - headerOffset, chunk.length - chunkOffset);
        chunk.copy(header, headerOffset, chunkOffset, chunkOffset + headerBytes);
        headerOffset += headerBytes;
        chunkOffset += headerBytes;
        if (headerOffset < IPC_FRAME_HEADER_BYTES) continue;

        const frameBytes = header.readUInt32LE(0);
        if (frameBytes === 0 || frameBytes > IPC_MAX_FRAME_BYTES) {
          fail(new Error(`Invalid official IPC frame length: ${frameBytes}`));
          return;
        }
        try {
          // 按声明长度只分配一次，避免大 snapshot 每到一个分片就复制全部历史数据。
          body = Buffer.allocUnsafe(frameBytes);
        } catch (error) {
          fail(error);
          return;
        }
      }

      const bodyBytes = Math.min(body.length - bodyOffset, chunk.length - chunkOffset);
      chunk.copy(body, bodyOffset, chunkOffset, chunkOffset + bodyBytes);
      bodyOffset += bodyBytes;
      chunkOffset += bodyBytes;
      if (bodyOffset < body.length) continue;

      const payload = body.toString("utf8");
      body = null;
      bodyOffset = 0;
      headerOffset = 0;
      try {
        onMessage(JSON.parse(payload));
      } catch (error) {
        fail(error);
        return;
      }
    }
  }

  function reset() {
    headerOffset = 0;
    body = null;
    bodyOffset = 0;
    failed = false;
  }

  return { consume, reset };
}

function reconnectDelayForAttempt(baseDelayMs, maxDelayMs, attempt) {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt));
}

function isExpectedSocketUnavailableError(error) {
  return error?.code === "ENOENT" || error?.code === "ECONNREFUSED";
}

function createOfficialLiveObserver(options = {}) {
  const socketPaths = Array.isArray(options.socketPaths) ? options.socketPaths.filter(Boolean) : [];
  const socketFactory =
    typeof options.socketFactory === "function" ? options.socketFactory : (socketPath) => net.createConnection(socketPath);
  const publish = typeof options.publish === "function" ? options.publish : () => {};
  const mobileProjector = createOfficialMobileStreamProjector({
    publish: typeof options.publishMobile === "function" ? options.publishMobile : undefined,
    maxStates: options.maxMobileStreamStates,
  });
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  const clientType = options.clientType || DEFAULT_CLIENT_TYPE;
  const reconnectDelayMs =
    // -1 是显式禁用重连的测试/关闭语义；生产默认从五秒开始退避。
    Number.isFinite(options.reconnectDelayMs) && options.reconnectDelayMs >= -1
      ? options.reconnectDelayMs
      : DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectDelayMs = Math.max(
    reconnectDelayMs,
    Number.isFinite(options.maxReconnectDelayMs) && options.maxReconnectDelayMs >= 0
      ? options.maxReconnectDelayMs
      : DEFAULT_MAX_RECONNECT_DELAY_MS
  );
  const configuredMaxKnownThreads = Number(options.maxKnownThreads);
  const maxKnownThreads =
    Number.isInteger(configuredMaxKnownThreads) && configuredMaxKnownThreads > 0
      ? configuredMaxKnownThreads
      : DEFAULT_MAX_KNOWN_THREADS;

  const knownThreads = new Map();
  const activeOwners = new Map();
  // 只保存可验证增量所需的 revision 元数据，不保存任何 snapshot/patch 内容。
  const activeRevisions = new Map();
  let socket = null;
  let socketPathIndex = 0;
  let clientId = "";
  let started = false;
  let stopped = false;
  let reconnectTimer = null;
  let parser = null;
  let initializeRequestId = 0;
  let reconnectAttempt = 0;

  function emit(channel, payload) {
    try {
      publish({ channel, payload });
    } catch (error) {
      onError(error);
    }
  }

  function emitOwnerDisconnected(ownerClientId) {
    // 官方 follower 在 owner 断开时依赖 client-status-changed 清理 stream role，避免永久 spinner。
    emit("client-status-changed", {
      type: "broadcast",
      method: "client-status-changed",
      sourceClientId: ownerClientId,
      params: { clientId: ownerClientId, status: "disconnected" },
    });
  }

  function clearActiveState() {
    for (const ownerClientId of new Set(activeOwners.values())) {
      if (ownerClientId) emitOwnerDisconnected(ownerClientId);
    }
    activeOwners.clear();
    activeRevisions.clear();
    mobileProjector.reset();
  }

  function emitConnectionReset(reason, sourceMessage = null) {
    emit("ipc-connection-reset", sourceMessage || {
      type: "broadcast",
      method: "ipc-connection-reset",
      params: { reason },
    });
  }

  function writeMessage(message) {
    if (!socket || socket.destroyed || socket.writable !== true) return false;
    try {
      socket.write(encodeIpcFrame(message));
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  function send(message) {
    if (!clientId) return false;
    return writeMessage(message);
  }

  function sendFollowing(conversationId, hostId, following) {
    // observer 只允许 initialize 和 following 广播，绝不生成任何 thread-follower 控制请求。
    return send({
      type: "broadcast",
      method: "thread-stream-following-changed",
      version: 1,
      sourceClientId: clientId,
      params: { conversationId, hostId, following },
    });
  }

  function resubscribeKnownThreads() {
    for (const { conversationId, hostId } of knownThreads.values()) {
      sendFollowing(conversationId, hostId, true);
    }
  }

  function forgetKnownThread(key, notifyOfficial = true) {
    const thread = knownThreads.get(key);
    if (!thread) return false;
    knownThreads.delete(key);
    activeOwners.delete(key);
    activeRevisions.delete(key);
    const separator = key.indexOf("\u0000");
    if (separator >= 0) mobileProjector.forget(key.slice(separator + 1), key.slice(0, separator));
    if (notifyOfficial && clientId) sendFollowing(thread.conversationId, thread.hostId, false);
    return true;
  }

  function rememberKnownThread(conversationId, hostId) {
    const key = threadKey(conversationId, hostId);
    // 重新观察视为最近使用；异常 owner 连续制造线程时只保留最近订阅，避免长会话状态无界增长。
    knownThreads.delete(key);
    knownThreads.set(key, { conversationId, hostId });
    while (knownThreads.size > maxKnownThreads) {
      const oldestKey = knownThreads.keys().next().value;
      if (!oldestKey || oldestKey === key) break;
      // 淘汰时同步取消官方订阅，不能只清本地 Map 后继续接收无用 stream。
      forgetKnownThread(oldestKey);
    }
    return key;
  }

  function handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "response" && message.method === "initialize") {
      if (message.resultType !== "success") {
        onError(new Error(`Official live IPC initialize failed: ${message.error || "unknown error"}`));
        return;
      }
      clientId = String(message.handledByClientId || message.result?.clientId || "");
      if (!clientId) {
        onError(new Error("Official live IPC initialize response did not include client id"));
        return;
      }
      resubscribeKnownThreads();
      return;
    }
    const method = String(message.method || (message.type === "ipc-connection-reset" ? message.type : ""));
    if (method === "ipc-connection-reset") {
      // reset 后只保留 knownThreads；旧 owner/revision 不能跨连接安全接收 patches。
      clearActiveState();
      emitConnectionReset("peer-reset", message);
      resubscribeKnownThreads();
      return;
    }
    if (message.type !== "broadcast") return;

    const params = message.params && typeof message.params === "object" ? message.params : {};
    const conversationId = typeof params.conversationId === "string" ? params.conversationId : "";
    const hostId = typeof params.hostId === "string" && params.hostId ? params.hostId : DEFAULT_HOST_ID;
    const key = conversationId ? threadKey(conversationId, hostId) : "";

    if (method === "thread-stream-following-status-requested") {
      // Desktop 新建任务可能不在 Web 首屏快照里；owner 主动询问 follower 时再按官方协议订阅。
      if (conversationId) observeThread(conversationId, hostId);
      return;
    }

    if (method === "thread-stream-state-changed") {
      if (!key) return;
      const change = params.change && typeof params.change === "object" ? params.change : null;
      const ownerClientId = typeof message.sourceClientId === "string" ? message.sourceClientId : "";
      // 首个 snapshot 可能早于 Web 首屏 catalog；patch 没有可用 baseRevision，不能跨 renderer 重放。
      if (!knownThreads.has(key) && change?.type !== "snapshot") return;
      if (change?.type === "snapshot") {
        // snapshot 代表线程正在活跃，刷新 LRU，避免异常压力下优先淘汰当前 stream。
        rememberKnownThread(conversationId, hostId);
        if (ownerClientId) activeOwners.set(key, ownerClientId);
        else activeOwners.delete(key);
        if (change.revision !== undefined && change.revision !== null) {
          activeRevisions.set(key, change.revision);
        } else {
          activeRevisions.delete(key);
        }
        emit(method, message);
        mobileProjector.consume(message);
        return;
      }
      if (change?.type !== "patches") return;
      if (activeOwners.get(key) !== ownerClientId) return;
      if (!activeRevisions.has(key) || activeRevisions.get(key) !== change.baseRevision) return;
      if (change.revision === undefined || change.revision === null) return;
      activeRevisions.set(key, change.revision);
      emit(method, message);
      mobileProjector.consume(message);
      return;
    }

    if (
      method === "client-status-changed" &&
      params.status === "disconnected" &&
      typeof params.clientId === "string"
    ) {
      let matched = false;
      for (const [thread, ownerClientId] of activeOwners.entries()) {
        if (ownerClientId !== params.clientId) continue;
        activeOwners.delete(thread);
        activeRevisions.delete(thread);
        const separator = thread.indexOf("\u0000");
        if (separator >= 0) mobileProjector.forget(thread.slice(separator + 1), thread.slice(0, separator));
        matched = true;
      }
      // client-status-changed 是 owner 级别的全局事件，多个 thread 只需向 renderer 转发一次。
      if (matched) emit(method, message);
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer || reconnectDelayMs < 0) return;
    const delayMs = reconnectDelayForAttempt(reconnectDelayMs, maxReconnectDelayMs, reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
    if (typeof reconnectTimer.unref === "function") reconnectTimer.unref();
  }

  function closeSocket() {
    const current = socket;
    socket = null;
    clientId = "";
    parser?.reset();
    parser = null;
    if (!current) return;
    current.removeAllListeners?.();
    try {
      current.destroy();
    } catch {}
  }

  function handleSocketClosed(current) {
    if (socket !== current) return;
    socket = null;
    clientId = "";
    parser?.reset();
    parser = null;
    clearActiveState();
    emitConnectionReset("socket-closed");
    scheduleReconnect();
  }

  function connect() {
    if (stopped || socket || socketPaths.length === 0) return;
    const socketPath = socketPaths[socketPathIndex % socketPaths.length];
    socketPathIndex += 1;
    let current;
    try {
      current = socketFactory(socketPath);
    } catch (error) {
      // Desktop 未运行是正常部署形态，缺失 socket/拒绝连接无需持续污染日志。
      if (!isExpectedSocketUnavailableError(error)) onError(error);
      scheduleReconnect();
      return;
    }
    socket = current;
    parser = createIpcFrameParser(handleMessage, (error) => {
      onError(error);
      current.destroy?.();
    });
    const onConnect = () => {
      reconnectAttempt = 0;
      initializeRequestId += 1;
      writeMessage({
        type: "request",
        requestId: `opencodex-observer-init-${initializeRequestId}`,
        method: "initialize",
        params: { clientType },
      });
    };
    current.once?.("connect", onConnect);
    current.on?.("data", (chunk) => parser?.consume(chunk));
    current.once?.("error", (error) => {
      if (!isExpectedSocketUnavailableError(error)) onError(error);
      handleSocketClosed(current);
    });
    current.once?.("close", () => handleSocketClosed(current));
  }

  function observeThread(conversationId, hostId = DEFAULT_HOST_ID) {
    if (typeof conversationId !== "string" || conversationId.length === 0) return false;
    const normalizedHostId = typeof hostId === "string" && hostId ? hostId : DEFAULT_HOST_ID;
    rememberKnownThread(conversationId, normalizedHostId);
    // Mobile 頁面可能喺 observer 已經訂閱後先建立 WS；清掉 projector 去重游標，
    // 等下一份官方 snapshot 將目前活動 turn 重新發送畀新頁面。
    mobileProjector.forget(conversationId, normalizedHostId);
    if (clientId) sendFollowing(conversationId, normalizedHostId, true);
    return true;
  }

  function observeSidebarBootstrap(bootstrap) {
    const entries = bootstrap?.catalogSnapshot?.entries;
    if (!Array.isArray(entries)) return 0;
    let observed = 0;
    const visibleThreads = new Set();
    for (const entry of entries) {
      const conversationId = entry?.threadId || entry?.conversationId;
      const hostId = entry?.hostId || DEFAULT_HOST_ID;
      if (observeThread(conversationId, hostId)) {
        visibleThreads.add(threadKey(conversationId, hostId));
        observed += 1;
      }
    }
    // sidebar bootstrap 是可见任务真源；移除不再可见的订阅，避免 knownThreads 只增不减。
    for (const key of knownThreads.keys()) {
      if (visibleThreads.has(key)) continue;
      forgetKnownThread(key);
    }
    return observed;
  }

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    connect();
  }

  function refresh() {
    resubscribeKnownThreads();
  }

  function stop() {
    stopped = true;
    started = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearActiveState();
    closeSocket();
  }

  return {
    observeSidebarBootstrap,
    observeThread,
    refresh,
    start,
    stop,
    __test: {
      getActiveOwners: () => new Map(activeOwners),
      getClientId: () => clientId,
      getKnownThreads: () => new Map(knownThreads),
      getMobileStreamStates: () => mobileProjector.__test.getStates(),
      handleMessage,
      encodeIpcFrame,
      mobileProjector,
    },
  };
}

module.exports = {
  createIpcFrameParser,
  createOfficialLiveObserver,
  createOfficialMobileStreamProjector,
  encodeIpcFrame,
  __test: {
    DEFAULT_CLIENT_TYPE,
    DEFAULT_HOST_ID,
    DEFAULT_MAX_KNOWN_THREADS,
    DEFAULT_MAX_RECONNECT_DELAY_MS,
    IPC_MAX_FRAME_BYTES,
    IPC_FRAME_HEADER_BYTES,
    DEFAULT_MAX_MOBILE_STREAM_STATES,
    MOBILE_STREAM_TEXT_LIMIT,
    MOBILE_STREAM_MAX_INITIAL_ITEMS,
    isExpectedSocketUnavailableError,
    reconnectDelayForAttempt,
    threadKey,
  },
};
