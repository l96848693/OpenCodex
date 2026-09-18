export type ConnectionState = "idle" | "connecting" | "ready" | "reconnecting" | "expired";
export type ConnectionEvent = "open" | "connected" | "failed" | "closed" | "resumed" | "ttl_expired" | "refresh";
export type TurnState = "idle" | "submitting" | "streaming" | "cancelling" | "completed" | "cancelled" | "failed";
export type TurnEvent = "send" | "accepted" | "rejected" | "final" | "cancel" | "cancelled" | "retry" | "next";

const connectionTransitions: Readonly<Record<ConnectionState, Partial<Record<ConnectionEvent, ConnectionState>>>> = {
  idle: { open: "connecting" },
  connecting: { connected: "ready", failed: "reconnecting", ttl_expired: "expired" },
  ready: { closed: "reconnecting", ttl_expired: "expired" },
  reconnecting: { resumed: "ready", connected: "ready", ttl_expired: "expired" },
  expired: { refresh: "idle" },
};

const turnTransitions: Readonly<Record<TurnState, Partial<Record<TurnEvent, TurnState>>>> = {
  idle: { send: "submitting" },
  submitting: { accepted: "streaming", rejected: "failed" },
  streaming: { final: "completed", cancel: "cancelling" },
  cancelling: { cancelled: "cancelled", final: "completed" },
  completed: { next: "idle" },
  cancelled: { next: "idle" },
  failed: { retry: "submitting", next: "idle" },
};

/** 非法轉移直接拋錯，避免 UI 悄悄吞掉時序競態。 */
export function reduceConnectionState(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  const next = connectionTransitions[state][event];
  if (!next) throw new Error(`Invalid mobile connection transition: ${state} -> ${event}`);
  return next;
}

/** Turn 狀態同網絡狀態完全分離，每個 thread 各自維護一份。 */
export function reduceTurnState(state: TurnState, event: TurnEvent): TurnState {
  const next = turnTransitions[state][event];
  if (!next) throw new Error(`Invalid mobile turn transition: ${state} -> ${event}`);
  return next;
}
