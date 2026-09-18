import {
  MOBILE_CONTRACT_VERSION,
  type MobileAuthStatus,
  type MobileAttachmentsResponse,
  type MobileBootstrap,
  type MobileModelsResponse,
  type MobileProjectsResponse,
  type MobileThreadResponse,
  type MobileThreadSummary,
  type MobileThreadsResponse,
  type MobileTurnResponse,
} from "@mobile-contract";
import { sha256Hex } from "./sha256";

interface LoginResponse {
  ok: boolean;
  authenticated: boolean;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; requestId?: string; retryAfterMs?: number };
}

const MOBILE_REQUEST_TIMEOUT_MS = 10_000;
const CONTRACT_RELOAD_KEY = "opencodex-mobile-contract-reloaded";

export class MobileRequestError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { code?: string; requestId?: string; status: number; retryAfterMs?: number }) {
    super(message);
    this.name = "MobileRequestError";
    this.code = options.code || "unknown_error";
    this.requestId = options.requestId || "";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = value && typeof value === "object" ? (value as ErrorEnvelope & { error?: unknown }) : {};
    const structured = record.error && typeof record.error === "object" ? record.error : null;
    const legacyMessage = typeof record.error === "string" ? record.error : "请求失败，请稍后再试。";
    const requestError = new MobileRequestError(`${response.status},${structured?.message || legacyMessage}`, {
      code: structured?.code,
      requestId: structured?.requestId || response.headers.get("x-request-id") || undefined,
      status: response.status,
      retryAfterMs: structured?.retryAfterMs,
    });
    if (response.status === 426 && sessionStorage.getItem(CONTRACT_RELOAD_KEY) !== "1") {
      sessionStorage.setItem(CONTRACT_RELOAD_KEY, "1");
      window.setTimeout(() => window.location.reload(), 0);
    }
    throw requestError;
  }
  return value as T;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), MOBILE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MobileRequestError("请求超时，请重试。", { code: "queue_expired", status: 408 });
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getAuthStatus(): Promise<MobileAuthStatus> {
  const response = await fetch("/api/auth/status", { cache: "no-store", credentials: "same-origin" });
  return readJson<MobileAuthStatus>(response);
}

export async function login(password: string): Promise<LoginResponse> {
  const passwordHash = await sha256Hex(password);
  const response = await fetch("/api/auth/login", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passwordHash }),
  });
  return readJson<LoginResponse>(response);
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store", credentials: "same-origin" });
  await readJson<{ ok: boolean }>(response);
}

export async function getBootstrap(): Promise<MobileBootstrap> {
  const response = await fetchWithTimeout("/api/mobile/bootstrap", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "x-opencodex-mobile-contract": String(MOBILE_CONTRACT_VERSION) },
  });
  const value = await readJson<MobileBootstrap>(response);
  sessionStorage.removeItem(CONTRACT_RELOAD_KEY);
  return value;
}

async function getMobileJson<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(path, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "x-opencodex-mobile-contract": String(MOBILE_CONTRACT_VERSION) },
  });
  return readJson<T>(response);
}

async function postMobileJson<T>(path: string, body: object, requestId: string): Promise<T> {
  const response = await fetchWithTimeout(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-opencodex-mobile-contract": String(MOBILE_CONTRACT_VERSION),
      "x-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
  return readJson<T>(response);
}

export function createMobileRequestId(prefix = "mob"): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function getProjects(): Promise<MobileProjectsResponse> {
  return getMobileJson<MobileProjectsResponse>("/api/mobile/projects");
}

export function getProjectThreads(projectId: string): Promise<MobileThreadsResponse> {
  return getMobileJson<MobileThreadsResponse>(`/api/mobile/projects/${encodeURIComponent(projectId)}/threads`);
}

export function getThread(threadId: string, cursor?: string | null): Promise<MobileThreadResponse> {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=5` : "?limit=5";
  return getMobileJson<MobileThreadResponse>(`/api/mobile/threads/${encodeURIComponent(threadId)}${suffix}`);
}

export function loadTurnItems(threadId: string, turnId: string, itemId: string, cursor?: string | null): Promise<{ data: Array<{ id: string; text: string; type: string }>; nextCursor: string | null }> {
  const params = new URLSearchParams({ itemId });
  if (cursor) params.set("cursor", cursor);
  return getMobileJson(`/api/mobile/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/items?${params.toString()}`);
}

export function getAppServerStatus(): Promise<{ data: { state: string; pid: number | null; retryCount: number; retryAfterMs: number; logs: Array<Record<string, unknown>> } }> {
  return getMobileJson("/api/mobile/app-server/status");
}

export function getAppServerLogs(): Promise<{ data: Array<Record<string, unknown>> }> {
  return getMobileJson("/api/mobile/app-server/logs?limit=10");
}

export function restartAppServer(requestId: string): Promise<{ status: string; retryAfterMs: number }> {
  return postMobileJson("/api/mobile/app-server/restart", {}, requestId);
}

export function acquireLease(sessionId: string, clientId: string, requestId: string) {
  return postMobileJson(`/api/mobile/sessions/${encodeURIComponent(sessionId)}/lease/acquire`, { clientId }, requestId);
}

export function heartbeatLease(sessionId: string, clientId: string, requestId: string) {
  return postMobileJson(`/api/mobile/sessions/${encodeURIComponent(sessionId)}/lease/heartbeat`, { clientId }, requestId);
}

export function getModels(): Promise<MobileModelsResponse> {
  return getMobileJson<MobileModelsResponse>("/api/mobile/models");
}

export function createThread(projectId: string, requestId: string, model?: string): Promise<{ data: MobileThreadSummary }> {
  return postMobileJson(`/api/mobile/projects/${encodeURIComponent(projectId)}/threads`, { model }, requestId);
}

export function sendMessage(
  threadId: string,
  input: { text: string; model?: string; reasoningEffort?: string; attachmentIds?: string[] },
  requestId: string
): Promise<MobileTurnResponse> {
  return postMobileJson(`/api/mobile/threads/${encodeURIComponent(threadId)}/messages`, input, requestId);
}

export function uploadAttachments(files: Array<{ name: string; type: string; size: number; lastModified: number; contentsBase64: string }>, requestId: string): Promise<MobileAttachmentsResponse> {
  return postMobileJson(`/api/mobile/attachments`, { files }, requestId);
}

export function cancelTurn(threadId: string, turnId: string, requestId: string): Promise<MobileTurnResponse> {
  return postMobileJson(`/api/mobile/turns/${encodeURIComponent(turnId)}/cancel`, { threadId }, requestId);
}

/** 未捕獲錯誤只上報脫敏元數據，唔帶消息正文、Cookie 或 token。 */
export function reportClientError(event: string, error: unknown): void {
  const candidate = error instanceof Error ? error : new Error(String(error));
  const payload = {
    event,
    data: {
      errorName: candidate.name.slice(0, 80),
      error: candidate.message.slice(0, 500),
      stack: String(candidate.stack || "").slice(0, 4_000),
      route: window.location.pathname.slice(0, 300),
      userAgent: navigator.userAgent.slice(0, 500),
    },
  };
  void fetch("/api/client-log", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
