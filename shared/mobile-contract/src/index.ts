/** Mobile API 契約版本；只喺有不兼容變更時先提升 major。 */
export const MOBILE_CONTRACT_VERSION = 1 as const;
export const MOBILE_MIN_CLIENT_VERSION = 1 as const;

export const MOBILE_ERROR_CODES = [
  "attachment_rejected",
  "app_server_restarting",
  "app_server_unavailable",
  "client_upgrade_required",
  "invalid_request",
  "not_authenticated",
  "queue_expired",
  "rate_limited",
  "sequence_gap",
  "session_expired",
  "session_state_syncing",
  "session_lease_conflict",
  "session_lease_expired",
  "session_read_timeout",
  "session_payload_too_large",
  "turn_interrupt_pending",
  "turn_conflict",
  "unknown_error",
] as const;

export type MobileErrorCode = (typeof MOBILE_ERROR_CODES)[number];
export type MobileConnectionState = "idle" | "connecting" | "ready" | "reconnecting" | "expired";
export type MobileTurnState =
  | "idle"
  | "submitting"
  | "streaming"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export interface MobileApiError {
  code: MobileErrorCode;
  message: string;
  requestId: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface MobileEventEnvelope<TPayload = unknown> {
  version: number;
  sequence: number;
  type: string;
  requestId?: string;
  threadId?: string;
  payload: TPayload;
}

export type MobileLiveEvent =
  | (MobileEventEnvelope<{
      turnId: string;
      itemId: string;
      kind: "user" | "message" | "reasoning";
      delta: string;
      phase?: string;
    }> & { type: "thread.message.delta"; threadId: string })
  | (MobileEventEnvelope<{
      turnId: string;
      status: "streaming" | "completed" | "cancelled" | "failed";
    }> & { type: "thread.turn.state"; threadId: string });

export interface MobileBootstrap {
  contractVersion: number;
  minClientVersion: number;
  serverInstanceId: string;
  serverTime: string;
  sessionExpiresAt: string | null;
  runtimeVersion: string;
  capabilities: MobileServerCapabilities;
}

export interface MobileServerCapabilities {
  attachments: boolean;
  chat: boolean;
  diagnostics: boolean;
  projects: boolean;
  streaming: boolean;
}

export interface MobileAuthStatus {
  ok: boolean;
  instanceId: string;
  authRequired: boolean;
  authenticated: boolean;
  expiresAtMs: number | null;
  ttlMs: number | null;
}

export interface MobileThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  status: "active" | "archived" | "unknown";
}

export interface MobileProjectSummary {
  id: string;
  name: string;
  lastActiveAt: string;
  latestThreadId: string;
  latestThreadTitle: string;
  threadCount: number;
  uncategorized: boolean;
}

export interface MobileProjectsResponse {
  data: MobileProjectSummary[];
  nextCursor: string | null;
}

export interface MobileThreadsResponse {
  data: MobileThreadSummary[];
  nextCursor: string | null;
  project: MobileProjectSummary;
}

export interface MobileMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  turnId: string;
  status: "streaming" | "success" | "failed" | "cancelled";
  truncated?: boolean;
  sourceItemId?: string;
  nextCursor?: string | null;
  /** agentMessage 的 commentary／工具过程与 final_answer 需要不同视觉语义。 */
  phase?: string;
  /** 回合建立时间；旧 App Server 无此字段时由回合 ID 提供稳定排序兜底。 */
  turnStartedAtMs?: number;
}

export interface MobileThreadDetail {
  id: string;
  title: string;
  status: "active" | "idle";
  activeTurnId: string | null;
  turnState: MobileTurnState;
  model: string;
  reasoningEffort: string;
  messages: MobileMessage[];
  truncated: boolean;
  turns?: MobileTurnSummary[];
  nextCursor?: string | null;
}

export interface MobileTurnSummary {
  id: string;
  status: string;
  itemCount: number;
  updatedAt: string;
}

export interface MobileThreadResponse {
  data: MobileThreadDetail;
}

export interface MobileModelOption {
  id: string;
  label: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
}

export interface MobileModelsResponse {
  data: MobileModelOption[];
}

export interface MobileTurnResponse {
  requestId: string;
  threadId: string;
  turnId: string;
  status: "streaming" | "cancelled";
}

export interface MobileAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl: string;
  expiresAt: string;
}

export interface MobileAttachmentsResponse {
  data: MobileAttachment[];
}

export interface MobileCapabilityProfile {
  compatible: boolean;
  blockingReasons: string[];
  warnings: string[];
  features: {
    abortController: boolean;
    dynamicViewport: boolean;
    resizeObserver: boolean;
    visualViewport: boolean;
    webSocket: boolean;
  };
}

export interface MobileCapabilitySource {
  AbortController?: unknown;
  ResizeObserver?: unknown;
  WebSocket?: unknown;
  CSS?: { supports?: (property: string, value: string) => boolean };
  visualViewport?: unknown;
}

/** 只按瀏覽器能力判斷，唔會因為未知品牌或 UA 阻擋可用裝置。 */
export function detectMobileCapabilities(source: MobileCapabilitySource): MobileCapabilityProfile {
  const features = {
    abortController: typeof source.AbortController === "function",
    dynamicViewport: Boolean(source.CSS?.supports?.("height", "100dvh")),
    resizeObserver: typeof source.ResizeObserver === "function",
    visualViewport: Boolean(source.visualViewport),
    webSocket: typeof source.WebSocket === "function",
  };
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  if (!features.webSocket) blockingReasons.push("缺少 WebSocket，无法连接 OpenCodex Gateway。");
  if (!features.abortController) blockingReasons.push("缺少 AbortController，无法安全取消请求。");
  if (!features.visualViewport) warnings.push("浏览器不提供 visualViewport，将使用视口高度差值适配软键盘。");
  if (!features.dynamicViewport) warnings.push("浏览器不支持动态视口单位，将使用 JavaScript 高度变量。");
  if (!features.resizeObserver) warnings.push("浏览器不支持 ResizeObserver，部分布局更新会降级。");
  return { compatible: blockingReasons.length === 0, blockingReasons, warnings, features };
}

export function isCompatibleContract(serverVersion: number, minClientVersion: number): boolean {
  return (
    Number.isInteger(serverVersion) &&
    Number.isInteger(minClientVersion) &&
    serverVersion >= MOBILE_MIN_CLIENT_VERSION &&
    MOBILE_CONTRACT_VERSION >= minClientVersion
  );
}

export function isMobileErrorCode(value: unknown): value is MobileErrorCode {
  return typeof value === "string" && (MOBILE_ERROR_CODES as readonly string[]).includes(value);
}

export function isMobileEventEnvelope(value: unknown): value is MobileEventEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileEventEnvelope>;
  return (
    Number.isInteger(candidate.version) &&
    Number.isInteger(candidate.sequence) &&
    Number(candidate.sequence) >= 0 &&
    typeof candidate.type === "string" &&
    candidate.type.length > 0 &&
    Object.prototype.hasOwnProperty.call(candidate, "payload")
  );
}

export function mobileError(
  code: MobileErrorCode,
  message: string,
  requestId = "",
  retryable = false,
  retryAfterMs?: number
): { error: MobileApiError } {
  return { error: { code, message, requestId, retryable, ...(Number.isFinite(retryAfterMs) ? { retryAfterMs: Math.max(0, Math.floor(retryAfterMs as number)) } : {}) } };
}
