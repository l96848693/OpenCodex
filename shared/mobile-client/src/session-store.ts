import type { ConnectionState } from "./state-machines";

export interface MobileSessionEvent {
  version: number;
  sequence: number;
  type: string;
  threadId?: string;
  payload: unknown;
  sequenceGap?: boolean;
}

export interface MobileSessionSnapshot {
  status: ConnectionState;
  attempt: number;
  disconnectedAt: number | null;
}

interface SessionSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface SessionClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface MobileSessionStoreOptions {
  url: string;
  clientId: string;
  gatewayInstanceId: string;
  contractVersion?: number;
  socketFactory?: (url: string) => SessionSocket;
  clock?: SessionClock;
  sessionTtlMs?: number;
  connectTimeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

const browserClock: SessionClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** 單一 Mobile WS 狀態源；斷線五分鐘後固定進入 expired，唔會無限重試。 */
export class MobileSessionStore {
  private readonly options: Required<Omit<MobileSessionStoreOptions, "socketFactory" | "clock">>;
  private readonly socketFactory: (url: string) => SessionSocket;
  private readonly clock: SessionClock;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: MobileSessionEvent) => void>();
  private socket: SessionSocket | null = null;
  private retryTimer: unknown;
  private expiryTimer: unknown;
  private connectTimer: unknown;
  private lastEventSequence: number | null = null;
  private disposed = false;
  private paused = false;
  private snapshot: MobileSessionSnapshot = { status: "idle", attempt: 0, disconnectedAt: null };

  constructor(options: MobileSessionStoreOptions) {
    this.options = {
      url: options.url,
      clientId: options.clientId,
      gatewayInstanceId: options.gatewayInstanceId,
      contractVersion: options.contractVersion ?? 1,
      sessionTtlMs: options.sessionTtlMs ?? 5 * 60_000,
      connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
      retryBaseMs: options.retryBaseMs ?? 500,
      retryMaxMs: options.retryMaxMs ?? 15_000,
    };
    // 原生 WebSocket 嘅事件 callback 比測試介面多事件參數；實際只用共同能力。
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as SessionSocket);
    this.clock = options.clock ?? browserClock;
  }

  getSnapshot = (): MobileSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeEvents = (listener: (event: MobileSessionEvent) => void): (() => void) => {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  };

  open(): void {
    if (this.disposed || this.socket || this.snapshot.status === "expired") return;
    this.update({ status: this.snapshot.disconnectedAt == null ? "connecting" : "reconnecting" });
    let socket: SessionSocket;
    try {
      socket = this.socketFactory(this.options.url);
    } catch {
      this.handleDisconnected();
      return;
    }
    this.socket = socket;
    this.connectTimer = this.clock.setTimeout(() => {
      if (this.socket !== socket) return;
      this.socket = null;
      try { socket.close(4000, "mobile-connect-timeout"); } catch {}
      this.handleDisconnected();
    }, this.options.connectTimeoutMs);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({
        type: "mobile:hello",
        clientId: this.options.clientId,
        gatewayInstanceId: this.options.gatewayInstanceId,
      }));
    };
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearConnectTimer();
      this.handleDisconnected();
    };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.clearRetryTimer();
    else if (this.snapshot.status === "reconnecting") this.scheduleReconnect(0);
  }

  retryNow(): void {
    if (this.snapshot.status !== "reconnecting") return;
    this.clearRetryTimer();
    this.open();
  }

  stop(): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(1000, "mobile-client-stopped"); } catch {}
    this.update({ status: "idle", attempt: 0, disconnectedAt: null });
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.listeners.clear();
    this.eventListeners.clear();
  }

  private handleMessage(socket: SessionSocket, raw: unknown): void {
    if (this.socket !== socket) return;
    let message: { type?: string; gatewayInstanceId?: string };
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.type === "gateway-session-expired") {
      this.expire();
      try { socket.close(4001, "gateway-session-expired"); } catch {}
      return;
    }
    if (message.type === "mobile:hello-ack" && message.gatewayInstanceId === this.options.gatewayInstanceId) {
      this.clearTimers();
      this.update({ status: "ready", attempt: 0, disconnectedAt: null });
      return;
    }
    const event = message as Partial<MobileSessionEvent>;
    if (
      !Number.isInteger(event.version) ||
      event.version !== this.options.contractVersion ||
      !Number.isInteger(event.sequence) ||
      Number(event.sequence) < 0 ||
      typeof event.type !== "string" ||
      !Object.prototype.hasOwnProperty.call(event, "payload")
    ) return;
    const sequence = Number(event.sequence);
    if (this.lastEventSequence != null && sequence <= this.lastEventSequence) return;
    const sequenceGap = this.lastEventSequence != null && sequence !== this.lastEventSequence + 1;
    this.lastEventSequence = sequence;
    const delivered = sequenceGap ? { ...(event as MobileSessionEvent), sequenceGap: true } : event as MobileSessionEvent;
    for (const listener of this.eventListeners) listener(delivered);
  }

  private handleDisconnected(): void {
    if (this.disposed || this.snapshot.status === "expired") return;
    const disconnectedAt = this.snapshot.disconnectedAt ?? this.clock.now();
    const elapsed = this.clock.now() - disconnectedAt;
    if (elapsed >= this.options.sessionTtlMs) { this.expire(); return; }
    const attempt = this.snapshot.attempt + 1;
    this.update({ status: "reconnecting", attempt, disconnectedAt });
    this.scheduleExpiry(this.options.sessionTtlMs - elapsed);
    const delay = Math.min(this.options.retryMaxMs, this.options.retryBaseMs * 2 ** Math.min(attempt - 1, 10));
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.disposed || this.paused || this.retryTimer != null) return;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = undefined;
      this.open();
    }, delayMs);
  }

  private scheduleExpiry(delayMs: number): void {
    if (this.expiryTimer != null) return;
    this.expiryTimer = this.clock.setTimeout(() => {
      this.expiryTimer = undefined;
      this.expire();
    }, Math.max(1, delayMs));
  }

  private expire(): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(4001, "mobile-session-expired"); } catch {}
    this.update({ status: "expired" });
  }

  private update(patch: Partial<MobileSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private clearRetryTimer(): void {
    if (this.retryTimer == null) return;
    this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer == null) return;
    this.clock.clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private clearTimers(): void {
    this.clearRetryTimer();
    this.clearConnectTimer();
    if (this.expiryTimer == null) return;
    this.clock.clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }
}
