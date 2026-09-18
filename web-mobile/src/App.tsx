import { Component, type ChangeEvent, type ErrorInfo, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { detectMobileCapabilities, type MobileAuthStatus, type MobileBootstrap, type MobileLiveEvent, type MobileMessage, type MobileThreadResponse } from "@mobile-contract";
import { MobileSessionStore, type MobileSessionSnapshot } from "@mobile-client";
import {
  getAuthStatus,
  getBootstrap,
  getModels,
  getProjects,
  getProjectThreads,
  getThread,
  loadTurnItems,
  getAppServerLogs,
  getAppServerStatus,
  acquireLease,
  heartbeatLease,
  login,
  logout,
  cancelTurn,
  createMobileRequestId,
  createThread,
  reportClientError,
  restartAppServer,
  sendMessage,
  uploadAttachments,
} from "./services/mobile-api";

type IconName = "chat" | "projects" | "settings" | "refresh" | "send";

/**
 * 將歷史頁同已載入嘅舊頁合併；每次都按權威頁嘅 turn 順序校正，唔保留
 * 之前可能已經錯序嘅陣列位置。未知 turn 只會排喺權威頁之前，代表更早嘅
 * 分頁資料，並按原有穩定順序保留。
 */
function compareTurnOrder(left: MobileMessage, right: MobileMessage): number {
  const leftStartedAt = Number(left.turnStartedAtMs) || 0;
  const rightStartedAt = Number(right.turnStartedAtMs) || 0;
  if (leftStartedAt > 0 && rightStartedAt > 0 && leftStartedAt !== rightStartedAt) return leftStartedAt - rightStartedAt;
  if (left.turnId !== right.turnId) return left.turnId < right.turnId ? -1 : 1;
  return 0;
}

function mergeHistoryMessages(current: MobileMessage[], page: MobileMessage[]): MobileMessage[] {
  const freshById = new Map(page.map((message) => [message.id, message]));
  const merged = current.map((message) => freshById.get(message.id) || message);
  const known = new Set(current.map((message) => message.id));
  for (const message of page) {
    if (!known.has(message.id)) merged.push(message);
  }

  const itemOrder = new Map<string, number>();
  page.forEach((message, index) => {
    itemOrder.set(message.id, index);
  });

  return merged
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const turnOrder = compareTurnOrder(left.message, right.message);
      if (turnOrder !== 0) return turnOrder;
      const leftItem = itemOrder.get(left.message.id);
      const rightItem = itemOrder.get(right.message.id);
      if (leftItem !== undefined && rightItem !== undefined && leftItem !== rightItem) return leftItem - rightItem;
      return left.index - right.index;
    })
    .map(({ message }) => message);
}

function mergeLiveMessages(current: MobileMessage[], incoming: MobileMessage[]): MobileMessage[] {
  const byId = new Map<string, MobileMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  const itemRank = new Map<string, number>();
  [...current, ...incoming].forEach((message, index) => { if (!itemRank.has(message.id)) itemRank.set(message.id, index); });
  return [...byId.values()].sort((left, right) => compareTurnOrder(left, right) || (itemRank.get(left.id)! - itemRank.get(right.id)!));
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    chat: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5.1 4v-4.5A2.5 2.5 0 0 1 4 12.6Z"/><path d="M8 8h8M8 11.5h5"/></>,
    projects: <><path d="M3.5 6.5h6l1.8 2H20a1.5 1.5 0 0 1 1.5 1.5v7.5A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5V8a1.5 1.5 0 0 1 1-1.5Z"/><path d="M3.5 6.5V5A1.5 1.5 0 0 1 5 3.5h4l1.5 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.09A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.09a1.7 1.7 0 0 0 1 1.71 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6c.15.39.36.73.67 1 .3.26.66.4 1.06.4h.09v4h-.09a1.7 1.7 0 0 0-1.73 1Z"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M19 11a7.5 7.5 0 1 0 .2 4"/></>,
    send: <><path d="m4 4 17 8-17 8 3-8Z"/><path d="M7 12h14"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function useViewportCoordinator() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const updateNow = () => {
      const viewport = window.visualViewport;
      const width = viewport?.width || root.clientWidth || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const keyboardInset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0));
      root.style.setProperty("--mobile-viewport-width", `${Math.max(280, width)}px`);
      root.style.setProperty("--mobile-viewport-height", `${height}px`);
      root.style.setProperty("--mobile-viewport-offset-top", `${Math.max(0, viewport?.offsetTop || 0)}px`);
      // keyboardInset 只作真機診斷觀測用，佈局唔依賴（避免排查時誤導）
      root.style.setProperty("--mobile-keyboard-inset", `${keyboardInset}px`);
      window.dispatchEvent(new CustomEvent("opencodex:viewport-change", { detail: { width, height, keyboardInset } }));
    };
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateNow);
    };
    const updateAfterOrientation = () => {
      update();
      window.setTimeout(update, 120);
      window.setTimeout(update, 360);
    };
    const viewport = window.visualViewport;
    const orientation = window.screen.orientation;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    updateNow();
    observer?.observe(root);
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", updateAfterOrientation, { passive: true });
    window.addEventListener("pageshow", updateAfterOrientation, { passive: true });
    orientation?.addEventListener?.("change", updateAfterOrientation);
    viewport?.addEventListener("resize", update, { passive: true });
    viewport?.addEventListener("scroll", update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", updateAfterOrientation);
      window.removeEventListener("pageshow", updateAfterOrientation);
      orientation?.removeEventListener?.("change", updateAfterOrientation);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);
}

function useViewportSnapshot() {
  const measure = () => ({
    width: Math.round(window.visualViewport?.width || window.innerWidth),
    height: Math.round(window.visualViewport?.height || window.innerHeight),
    dpr: window.devicePixelRatio,
  });
  const [value, setValue] = useState(measure);
  useEffect(() => {
    const update = () => setValue(measure());
    window.addEventListener("opencodex:viewport-change", update);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("opencodex:viewport-change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return value;
}

function browserLabel() {
  const ua = navigator.userAgent;
  const match = ua.match(/SamsungBrowser\/(\d+(?:\.\d+)*)/) || ua.match(/EdgA?\/(\d+(?:\.\d+)*)/) || ua.match(/Chrome\/(\d+(?:\.\d+)*)/);
  const name = ua.includes("SamsungBrowser") ? "Samsung Internet" : ua.includes("Edg") ? "Microsoft Edge" : "Chromium";
  return `${name} ${match?.[1] || "未知版本"}`;
}

function LoadingScreen({ label = "正在连接 Gateway" }: { label?: string }) {
  return <main className="center-screen" aria-live="polite"><div className="brand-mark">O</div><div className="spinner"/><p>{label}</p></main>;
}

function LoginPage() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["mobile-auth"] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password && !mutation.isPending) mutation.mutate(password);
  };
  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark">O</div>
        <p className="eyebrow">OPENCODEX MOBILE</p>
        <h1 id="login-title">继续你嘅任务</h1>
        <p className="muted">输入 Gateway 访问密码。凭据只会发送到当前同源设备。</p>
        <form onSubmit={submit}>
          <label htmlFor="gateway-password">访问密码</label>
          <input id="gateway-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          {mutation.isError && <p className="form-error" role="alert">{mutation.error instanceof Error ? mutation.error.message : "登录失败，请重试。"}</p>}
          <button className="primary-button" type="submit" disabled={!password || mutation.isPending}>{mutation.isPending ? "正在验证…" : "进入移动版"}</button>
        </form>
      </section>
    </main>
  );
}

function CompatibilityGate({ children }: { children: ReactNode }) {
  const profile = useMemo(() => detectMobileCapabilities(window), []);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("opencodex-mobile-capability-notice") === "1");
  if (!profile.compatible) {
    return <main className="center-screen compatibility-page"><div className="status-symbol danger">!</div><p className="eyebrow">兼容性检查未通过</p><h1>当前浏览器缺少必要能力</h1><p>{browserLabel()}</p><ul>{profile.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p className="muted">请更新 Android Edge、Chrome 或 Samsung Internet，再重新打开页面。</p></main>;
  }
  return <>{!dismissed && profile.warnings.length > 0 && <aside className="capability-notice"><div><strong>浏览器将使用兼容模式</strong><span>{browserLabel()}</span><ul>{profile.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div><button type="button" onClick={() => { sessionStorage.setItem("opencodex-mobile-capability-notice", "1"); setDismissed(true); }} aria-label="关闭兼容性提示">×</button></aside>}{children}</>;
}

function useOnlineState() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

function mobileClientId(): string {
  const key = "opencodex-mobile-client-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const value = `mobile_${random}`;
  sessionStorage.setItem(key, value);
  return value;
}

function useMobileSession(bootstrap: MobileBootstrap, online: boolean): { snapshot: MobileSessionSnapshot; store: MobileSessionStore } {
  const store = useMemo(() => new MobileSessionStore({
    url: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
    clientId: mobileClientId(),
    gatewayInstanceId: bootstrap.serverInstanceId,
    contractVersion: bootstrap.contractVersion,
  }), [bootstrap.serverInstanceId]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const syncVisibility = () => {
      const paused = !navigator.onLine || document.visibilityState === "hidden";
      store.setPaused(paused);
      if (!paused) { store.open(); store.retryNow(); }
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => { document.removeEventListener("visibilitychange", syncVisibility); store.stop(); };
  }, [store]);
  useEffect(() => {
    const paused = !online || document.visibilityState === "hidden";
    store.setPaused(paused);
    if (!paused) { store.open(); store.retryNow(); }
  }, [online, store]);
  return { snapshot, store };
}

function ConnectionBanner({ status, online, expired, retry }: { status: MobileSessionSnapshot["status"]; online: boolean; expired: boolean; retry: () => void }) {
  const [visible, setVisible] = useState(false);
  const ready = online && status === "ready";
  useEffect(() => {
    if (ready && !expired) { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(true), expired ? 0 : 3_000);
    return () => window.clearTimeout(timer);
  }, [ready, expired]);
  if (!visible) return null;
  return <aside className={`connection-banner ${expired ? "is-expired" : ""}`} role="status"><span className="connection-dot"/><div><strong>{expired ? "连接已过期" : "同 Gateway 断开连接"}</strong><small>{expired ? "请刷新页面后继续。" : "正等待网络恢复，未发送内容会保留。"}</small></div><button type="button" onClick={retry}><Icon name="refresh"/><span>刷新</span></button></aside>;
}

function ChatPage({ bootstrap, sessionStatus, sessionStore }: { bootstrap: MobileBootstrap; sessionStatus: MobileSessionSnapshot["status"]; sessionStore: MobileSessionStore }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => sessionStorage.getItem("opencodex-mobile-draft") || "");
  const [pendingText, setPendingText] = useState("");
  const [failedRequest, setFailedRequest] = useState<{ requestId: string; text: string } | null>(null);
  const [following, setFollowing] = useState(true);
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("");
  // 開啟會話只係讀取，未經用戶明確揀選之前唔可以將任何模型寫返上游。
  const [modelOverride, setModelOverride] = useState(false);
  const [reasoningEffortOverride, setReasoningEffortOverride] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string }>>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [liveMessages, setLiveMessages] = useState<MobileMessage[]>([]);
  // 按 turn 保存统一状态，避免同一回合的不同 item 出现互相矛盾的状态。
  const [turnStatusById, setTurnStatusById] = useState<Record<string, MobileMessage["status"]>>({});
  // WS 事件可能早過歷史快照到達；保留觀測到嘅活動 turn，避免短暫誤報已停止。
  const [observedActiveTurnId, setObservedActiveTurnId] = useState<string | null>(null);
  const [loadedMessages, setLoadedMessages] = useState<MobileMessage[]>([]);
  const [nextHistoryCursor, setNextHistoryCursor] = useState<string | null>(null);
  const [loadedTurns, setLoadedTurns] = useState(5);
  const [itemContinuations, setItemContinuations] = useState<Record<string, { text: string; nextCursor: string | null }>>({});
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const initialScrollThreadRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("opencodex-mobile-selected-thread") || "null") as { id: string; title: string } | null;
    } catch {
      return null;
    }
  }, []);
  const clientId = useMemo(() => {
    const key = "opencodex-mobile-client-id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const next = createMobileRequestId("client");
    localStorage.setItem(key, next);
    return next;
  }, []);
  const [leaseOwned, setLeaseOwned] = useState(true);
  useEffect(() => {
    if (!selected?.id) return;
    setLeaseOwned(false);
    let disposed = false;
    const acquire = async () => {
      try { await acquireLease(selected.id, clientId, createMobileRequestId("lease")); if (!disposed) setLeaseOwned(true); }
      catch (error) { if (!disposed) setLeaseOwned(false); reportClientError("lease_acquire", error); }
    };
    void acquire();
    const timer = window.setInterval(async () => {
      try { await heartbeatLease(selected.id, clientId, createMobileRequestId("heartbeat")); if (!disposed) setLeaseOwned(true); }
      catch { if (!disposed) setLeaseOwned(false); }
    }, 30_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [clientId, selected?.id]);
  const threadQuery = useQuery({
    queryKey: ["mobile-thread", selected?.id],
    queryFn: () => getThread(selected!.id),
    enabled: Boolean(selected?.id),
    // 活躍回合由 WS delta 推動；輪詢只作閒置狀態同步，避免舊 snapshot 蓋走新增量。
    refetchInterval: () => document.visibilityState === "visible" ? 5_000 : false,
  });
  const refetchThread = threadQuery.refetch;
  const modelsQuery = useQuery({ queryKey: ["mobile-models"], queryFn: getModels, enabled: Boolean(selected?.id) });
  const activeThread = threadQuery.data?.data;
  const activeTurnRef = useRef<string | null>(null);
  const liveMessagesRef = useRef<MobileMessage[]>([]);
  const observedActiveTurnRef = useRef<string | null>(null);
  const turnStatusRef = useRef<Record<string, MobileMessage["status"]>>({});
  const snapshotActiveTurnId = activeThread?.turnState === "streaming" ? activeThread.activeTurnId : null;
  const liveActiveTurnId = liveMessages.find((message) => message.status === "streaming")?.turnId || null;
  // WS 事件比 HTTP 輪詢快，活動狀態要優先採用已觀測事件，避免舊 snapshot 蓋返「已停止」。
  activeTurnRef.current = observedActiveTurnRef.current || liveActiveTurnId || snapshotActiveTurnId || activeTurnRef.current || null;
  liveMessagesRef.current = liveMessages;
  turnStatusRef.current = turnStatusById;
  useEffect(() => {
    if (!activeThread) return;
    const protectedActiveTurnId = observedActiveTurnRef.current
      || activeTurnRef.current
      || (activeThread.turnState === "streaming" ? activeThread.activeTurnId : null);
    if (protectedActiveTurnId) {
      setTurnStatusById((current) => current[protectedActiveTurnId] === "streaming"
        ? current
        : { ...current, [protectedActiveTurnId]: "streaming" });
    }
    setLoadedMessages((current) => {
      const normalizeStatus = (message: MobileMessage) => {
        const status = protectedActiveTurnId === message.turnId
          ? "streaming"
          : turnStatusRef.current[message.turnId];
        return status ? { ...message, status } : message;
      };
      if (current.length === 0) return activeThread.messages.map(normalizeStatus);
      const pageMessages = activeThread.messages.map(normalizeStatus);
      return mergeHistoryMessages(current, pageMessages);
    });
    setNextHistoryCursor((current) => current || activeThread.nextCursor || null);
    // 輪詢係跨端同步嘅後備通道；如果 WebSocket 曾經漏咗 delta，將權威文字補返到暫存回顯。
    setLiveMessages((current) => {
      if (!current.length) return current;
      const freshById = new Map(activeThread.messages.map((message) => [message.id, message]));
      const terminalTurnIds = new Set(activeThread.messages.filter((message) => message.status !== "streaming").map((message) => message.turnId));
      let changed = false;
      const next = current
        .filter((message) => !(message.turnId !== protectedActiveTurnId && terminalTurnIds.has(message.turnId)))
        .map((message) => {
          const fresh = freshById.get(message.id);
          if (!fresh) return message;
          const text = fresh.text.length >= message.text.length ? fresh.text : message.text;
          const status = message.turnId === protectedActiveTurnId
            ? "streaming"
            : turnStatusRef.current[message.turnId] || fresh.status;
          // HTTP 權威資料亦會校正 item 類型，避免早到 delta 將 reasoning 永久畫成普通文字氣泡。
          if (text !== message.text || fresh.role !== message.role || status !== message.status) {
            changed = true;
            return { ...message, role: fresh.role, text, status };
          }
          return message;
        });
      if (next.length !== current.length) changed = true;
      return changed ? next : current;
    });
  }, [activeThread]);
  const activeModel = modelsQuery.data?.data.find((candidate) => candidate.id === model);
  const efforts = activeModel?.supportedReasoningEfforts || [];

  useEffect(() => {
    if (!activeThread || modelOverride || reasoningEffortOverride) return;
    // 唔用 model/list 嘅 isDefault 做回退；未知／自定義模型必須由 App Server 保留。
    // 呢度只係展示当前会话已知值，发送时仍由 override 开关决定是否透传。
    setModel(activeThread.model || "");
    setReasoningEffort(activeThread.reasoningEffort || "");
  }, [activeThread, modelOverride, reasoningEffortOverride]);
  useEffect(() => { sessionStorage.setItem("opencodex-mobile-draft", draft); }, [draft]);
  useEffect(() => {
    if (!following || !listRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThread?.messages, following, liveMessages, loadedMessages, pendingText]);
  useLayoutEffect(() => {
    if (!selected?.id || !activeThread || activeThread.id !== selected.id || loadedMessages.length === 0 || initialScrollThreadRef.current === selected.id) return;
    const node = listRef.current;
    if (!node) return;
    initialScrollThreadRef.current = selected.id;
    // 首屏历史完成布局后立即落到底部；第二帧应付字体／异步内容令 scrollHeight 再增长嘅情况。
    node.scrollTop = node.scrollHeight;
    const frame = window.requestAnimationFrame(() => {
      if (listRef.current === node && following) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeThread, following, loadedMessages.length, selected?.id]);
  useEffect(() => { initialScrollThreadRef.current = null; activeTurnRef.current = null; observedActiveTurnRef.current = null; turnStatusRef.current = {}; setObservedActiveTurnId(null); setTurnStatusById({}); setFollowing(true); setLiveMessages([]); setLoadedMessages([]); setNextHistoryCursor(null); setLoadedTurns(5); setItemContinuations({}); setLoadingItemId(null); setModel(""); setReasoningEffort(""); setModelOverride(false); setReasoningEffortOverride(false); }, [selected?.id]);
  useEffect(() => sessionStore.subscribeEvents((sessionEvent) => {
    const event = sessionEvent as MobileLiveEvent;
    if (!selected?.id || event.threadId !== selected.id) return;
    if (sessionEvent.sequenceGap) {
      // 裝置休眠期間一旦漏事件，立即用 Gateway 權威快照補齊，唔估算缺失內容。
      void refetchThread();
    }
    if (event.type === "thread.turn.state") {
      if (event.payload.status === "streaming") {
        activeTurnRef.current = event.payload.turnId;
        observedActiveTurnRef.current = event.payload.turnId;
        setObservedActiveTurnId(event.payload.turnId);
        setTurnStatusById((current) => ({ ...current, [event.payload.turnId]: "streaming" }));
        setLoadedMessages((current) => current.map((message) => message.turnId === event.payload.turnId ? { ...message, status: "streaming" } : message));
        setLiveMessages((current) => current.map((message) => message.turnId === event.payload.turnId ? { ...message, status: "streaming" } : message));
        queryClient.setQueryData<MobileThreadResponse>(["mobile-thread", selected.id], (current) => current ? {
          ...current,
          data: { ...current.data, activeTurnId: event.payload.turnId, turnState: "streaming" },
        } : current);
      } else {
        const cached = queryClient.getQueryData<MobileThreadResponse>(["mobile-thread", selected.id]);
        const currentTurnId = observedActiveTurnRef.current || activeTurnRef.current || cached?.data.activeTurnId;
        const hasLiveTurn = liveMessagesRef.current.some((message) => message.turnId === event.payload.turnId);
        // 舊回合迟到的 terminal 通知唔可以覆盖新回合状态。
        if ((currentTurnId && currentTurnId !== event.payload.turnId) || (!currentTurnId && !hasLiveTurn)) return;
        // 终态通知可能早於 App Server 的正式快照；先确认权威状态，避免「后台仍运行」却显示已停止。
        void refetchThread().then((result) => {
          const refreshed = result.data?.data;
          if (!result.isSuccess || refreshed?.activeTurnId === event.payload.turnId || refreshed?.turnState === "streaming") {
            activeTurnRef.current = event.payload.turnId;
            observedActiveTurnRef.current = event.payload.turnId;
            setObservedActiveTurnId(event.payload.turnId);
            setTurnStatusById((current) => ({ ...current, [event.payload.turnId]: "streaming" }));
            setLoadedMessages((current) => current.map((message) => message.turnId === event.payload.turnId ? { ...message, status: "streaming" } : message));
            setLiveMessages((current) => current.map((message) => message.turnId === event.payload.turnId ? { ...message, status: "streaming" } : message));
            queryClient.setQueryData<MobileThreadResponse>(["mobile-thread", selected.id], (current) => current ? {
              ...current,
              data: { ...current.data, activeTurnId: event.payload.turnId, turnState: "streaming" },
            } : current);
            return;
          }
          activeTurnRef.current = null;
          observedActiveTurnRef.current = null;
          setObservedActiveTurnId(null);
          const itemStatus: MobileMessage["status"] = event.payload.status === "completed" ? "success" : event.payload.status;
          setTurnStatusById((current) => ({ ...current, [event.payload.turnId]: itemStatus }));
          setLoadedMessages((current) => current.map((message) => message.turnId === event.payload.turnId ? { ...message, status: itemStatus } : message));
          queryClient.setQueryData<MobileThreadResponse>(["mobile-thread", selected.id], (current) => current ? {
            ...current,
            data: { ...current.data, activeTurnId: null, turnState: event.payload.status === "completed" ? "completed" : event.payload.status },
          } : current);
          setLiveMessages((current) => current.map((message) => message.turnId === event.payload.turnId ? { ...message, status: itemStatus } : message));
          setLiveMessages((current) => current.filter((message) => message.turnId !== event.payload.turnId));
          void queryClient.invalidateQueries({ queryKey: ["mobile-project-threads"] });
        });
      }
      return;
    }
    const cached = queryClient.getQueryData<MobileThreadResponse>(["mobile-thread", selected.id]);
    // 已收到新活動 turn 後先丟棄舊 turn 遲到 delta；單靠可能滯後嘅 HTTP snapshot 唔可以阻止新事件。
    if (observedActiveTurnRef.current && observedActiveTurnRef.current !== event.payload.turnId) return;
    activeTurnRef.current = event.payload.turnId;
    observedActiveTurnRef.current = event.payload.turnId;
    setObservedActiveTurnId(event.payload.turnId);
    setTurnStatusById((current) => ({ ...current, [event.payload.turnId]: "streaming" }));
    setLoadedMessages((current) => current.map((message) => message.turnId === event.payload.turnId ? { ...message, status: "streaming" } : message));
    queryClient.setQueryData<MobileThreadResponse>(["mobile-thread", selected.id], (current) => current ? {
      ...current,
      data: { ...current.data, activeTurnId: event.payload.turnId, turnState: "streaming" },
    } : current);
    setLiveMessages((current) => {
      const messageId = event.payload.itemId;
      const existingIndex = current.findIndex((message) => message.id === messageId);
      const authoritative = queryClient.getQueryData<MobileThreadResponse>(["mobile-thread", selected.id]);
      const authoritativeText = authoritative?.data.messages.find((message) => message.id === messageId)?.text || "";
      if (existingIndex < 0) {
        const text = authoritativeText.endsWith(event.payload.delta) ? authoritativeText : authoritativeText + event.payload.delta;
        return [...current, {
          id: event.payload.itemId,
          role: event.payload.kind === "user"
            ? "user"
            : event.payload.kind === "reasoning" || event.payload.phase && event.payload.phase !== "final_answer" && event.payload.phase !== "final"
              ? "tool"
              : "assistant",
          phase: event.payload.phase,
          text,
          turnId: event.payload.turnId,
          status: "streaming",
        }];
      }
      const messages = [...current];
      const existing = messages[existingIndex]!;
      let text = existing.text;
      if (authoritativeText.length > text.length) text = authoritativeText;
      if (!text.endsWith(event.payload.delta)) text += event.payload.delta;
      messages[existingIndex] = {
        ...existing,
        role: event.payload.kind === "user"
          ? "user"
          : event.payload.kind === "reasoning" || event.payload.phase && event.payload.phase !== "final_answer" && event.payload.phase !== "final"
            ? "tool"
            : existing.role,
        phase: event.payload.phase || existing.phase,
        text,
        status: "streaming",
      };
      return messages;
    });
  }), [queryClient, refetchThread, selected?.id, sessionStore]);

  const sendMutation = useMutation({
    mutationFn: (submission: { requestId: string; text: string; attachmentIds?: string[] }) => sendMessage(selected!.id, {
      text: submission.text,
      ...(modelOverride && model ? { model } : {}),
      ...(reasoningEffortOverride && reasoningEffort ? { reasoningEffort } : {}),
      attachmentIds: submission.attachmentIds,
    }, submission.requestId),
    onMutate: (submission) => { setPendingText(submission.text); setFailedRequest(null); },
    onSuccess: async () => {
      setDraft("");
      setAttachments([]);
      sessionStorage.removeItem("opencodex-mobile-draft");
      setPendingText("");
      await queryClient.invalidateQueries({ queryKey: ["mobile-thread", selected?.id] });
    },
    onError: (_error, submission) => { setPendingText(""); setFailedRequest(submission); },
  });
  const activeTurnId = observedActiveTurnId
    || liveMessages.find((message) => message.status === "streaming")?.turnId
    || (activeThread?.turnState === "streaming" ? activeThread.activeTurnId : null)
    || null;
  const turnIsActive = activeThread?.turnState === "streaming" || Boolean(activeTurnId);
  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!selected?.id || !activeTurnId) throw new Error("当前任务尚未取得有效回合编号，请刷新页面。");
      return cancelTurn(selected.id, activeTurnId, createMobileRequestId("cancel"));
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["mobile-thread", selected?.id] }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    // 淨係附件都可以發送；唔可以用文字欄位非空作為唯一發送條件。
    if ((!text && attachments.length === 0) || sendMutation.isPending || turnIsActive || sessionStatus !== "ready" || !leaseOwned) return;
    sendMutation.mutate({ requestId: createMobileRequestId("msg"), text, attachmentIds: attachments.map((item) => item.id) });
  };
  const retry = () => { if (failedRequest && !sendMutation.isPending) sendMutation.mutate({ ...failedRequest, attachmentIds: attachments.map((item) => item.id) }); };
  const chooseFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    try {
      setAttachmentError("");
      const encoded = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, contentsBase64: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = () => reject(reader.error || new Error("读取附件失败")); reader.readAsDataURL(file); }) })));
      const result = await uploadAttachments(encoded, createMobileRequestId("att"));
      setAttachments((current) => [...current, ...result.data.map((item) => ({ id: item.id, name: item.name }))]);
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : "附件上传失败，请重试。"); }
  };
  const onScroll = () => {
    const node = listRef.current;
    if (node) {
      setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 56);
      if (node.scrollTop <= 12 && nextHistoryCursor && loadedTurns < 50 && !threadQuery.isFetching) {
        const oldHeight = node.scrollHeight;
        void getThread(selected!.id, nextHistoryCursor).then((page) => {
          setLoadedMessages((current) => mergeHistoryMessages(current, page.data.messages));
          setNextHistoryCursor(page.data.nextCursor || null);
          setLoadedTurns((current) => Math.min(50, current + 5));
          requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - oldHeight; });
        });
      }
    }
  };
  const loadMoreItem = async (message: MobileMessage) => {
    const continuation = itemContinuations[message.id];
    const cursor = continuation ? continuation.nextCursor : message.nextCursor;
    if (!cursor || loadingItemId) return;
    setLoadingItemId(message.id);
    try {
      const result = await loadTurnItems(selected!.id, message.turnId, message.sourceItemId || message.id, cursor);
      setItemContinuations((current) => ({ ...current, [message.id]: { text: `${current[message.id]?.text || ""}${result.data.map((item) => item.text).join("\n")}`, nextCursor: result.nextCursor } }));
    } catch (error) { reportClientError("load_more_item", error); }
    finally { setLoadingItemId(null); }
  };
  const visibleMessages = mergeLiveMessages(loadedMessages, liveMessages);
  /**
   * App Server 的历史分页同实时事件偶尔会出现 turnId 暂时缺失／不一致：
   * 例如用户 item 已经落盘，但后续工具 item 仍由 stream 追加。页面不能
   * 因为这个传输层短暂差异，将一个用户回合拆成「已停止」和「流式中」两组。
   * 视觉层按用户 item 切分连续回合，后台 turnId 仍保留作取消任务用。
   */
  const visualTurnKeyByIndex: string[] = [];
  let visualTurnIndex = 0;
  visibleMessages.forEach((message, index) => {
    if (index > 0 && message.role === "user") visualTurnIndex += 1;
    visualTurnKeyByIndex[index] = `visual-turn-${visualTurnIndex}`;
  });
  const lastItemIndexByVisualTurn = new Map<string, number>();
  const visualTurnMessages = new Map<string, MobileMessage[]>();
  visibleMessages.forEach((message, index) => {
    const key = visualTurnKeyByIndex[index]!;
    lastItemIndexByVisualTurn.set(key, index);
    const rows = visualTurnMessages.get(key) || [];
    rows.push(message);
    visualTurnMessages.set(key, rows);
  });
  const statusForVisualTurn = (visualTurnKey: string, message: MobileMessage): MobileMessage["status"] => {
    const rows = visualTurnMessages.get(visualTurnKey) || [message];
    // 同一视觉回合只要有一个 item 仍在流式，全部 item 都显示同一状态。
    if (rows.some((row) => row.status === "streaming" || row.turnId === activeTurnId)) return "streaming";
    const knownStatuses = rows
      .map((row) => turnStatusById[row.turnId] || row.status)
      .filter((status): status is MobileMessage["status"] => Boolean(status));
    if (knownStatuses.includes("streaming")) return "streaming";
    if (knownStatuses.includes("failed")) return "failed";
    if (knownStatuses.includes("cancelled")) return "cancelled";
    return knownStatuses[knownStatuses.length - 1] || message.status;
  };
  const statusLabel = (status: MobileMessage["status"]) => status === "streaming" ? "流式中" : status === "failed" ? "失败" : status === "cancelled" ? "已停止" : "";
  const renderMessage = (message: MobileMessage, index: number) => {
    const continuation = itemContinuations[message.id];
    const text = `${message.text}${continuation?.text || ""}`;
    const more = continuation ? continuation.nextCursor : message.nextCursor;
    // 状态属于整个 turn，只在最后一个可见 item 展示一次。
    const visualTurnKey = visualTurnKeyByIndex[index]!;
    const label = lastItemIndexByVisualTurn.get(visualTurnKey) === index ? statusLabel(statusForVisualTurn(visualTurnKey, message)) : "";
    if (message.role === "tool") return <article className="tool-message" key={message.id}><details><summary>{text.split("\n")[0]}</summary><pre>{text}</pre>{more && <button className="text-button" type="button" onClick={() => void loadMoreItem(message)} disabled={loadingItemId === message.id}>{loadingItemId === message.id ? "加载中…" : "加载更多"}</button>}</details>{label && <small className="turn-status">{label}</small>}</article>;
    return <article className={`message-bubble ${message.role}`} key={message.id}><p>{text}</p>{more && <button className="text-button" type="button" onClick={() => void loadMoreItem(message)} disabled={loadingItemId === message.id}>{loadingItemId === message.id ? "加载中…" : "加载更多"}</button>}{label && <small className="turn-status">{label}</small>}</article>;
  };

  return <section className="page chat-page">
    <header className="topbar chat-topbar"><div><span className={`connection-pill ${sessionStatus}`}><i/>{sessionStatus === "ready" ? "已连接" : sessionStatus === "expired" ? "已过期" : "连接中"}</span><h1>{activeThread?.title || selected?.title || "新对话"}</h1></div><button className="round-button" type="button" aria-label="刷新当前对话" onClick={() => void threadQuery.refetch()}><Icon name="refresh"/></button></header>
    {!selected && <div className="empty-chat"><div className="orb"><span/></div><h2>由项目开始</h2><p>选择现有对话，或者进入项目新建对话。</p><button className="secondary-button" type="button" onClick={() => navigate("/projects")}>选择项目</button></div>}
    {selected && <><div className="chat-controls" aria-label="模型设置"><label>模型<select value={model} onChange={(event) => { const nextModel = event.target.value; setModel(nextModel); setModelOverride(Boolean(nextModel)); const option = modelsQuery.data?.data.find((candidate) => candidate.id === nextModel); setReasoningEffort(option?.defaultReasoningEffort || ""); setReasoningEffortOverride(Boolean(option?.defaultReasoningEffort)); }} disabled={modelsQuery.isPending}><option value="">沿用当前会话模型{activeThread?.model ? `（${activeThread.model}）` : ""}</option>{activeThread?.model && !modelsQuery.data?.data.some((option) => option.id === activeThread.model) && <option value={activeThread.model}>自定义模型（{activeThread.model}）</option>}{modelsQuery.data?.data.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>推理<select value={reasoningEffort} onChange={(event) => { setReasoningEffort(event.target.value); setReasoningEffortOverride(Boolean(event.target.value)); }} disabled={!efforts.length}><option value="">沿用当前会话推理</option>{efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></label></div>
      <div className="message-list" ref={listRef} onScroll={onScroll}>
        {threadQuery.isPending && <ProjectSkeleton/>}
        {threadQuery.isError && <div className="notice-card error-card"><span className="status-symbol danger">!</span><div><h2>对话内容加载失败</h2><p>{threadQuery.error instanceof Error ? threadQuery.error.message : "请稍后重试。"}</p><button className="text-button" type="button" onClick={() => void threadQuery.refetch()}>再试一次</button></div></div>}
        {activeThread?.truncated && <p className="history-note">为保持手机性能，只显示最近 {activeThread.messages.length} 条内容。</p>}
        {activeThread && activeThread.messages.length === 0 && !pendingText && <div className="empty-section compact"><h2>呢个对话仲未有内容</h2><p>可以喺下方输入第一条消息。</p></div>}
        {visibleMessages.map(renderMessage)}
        {pendingText && <article className="message-bubble user pending"><p>{pendingText}</p><small>发送中</small></article>}
        {failedRequest && <div className="send-error" role="alert"><span>{sendMutation.error instanceof Error ? sendMutation.error.message : "发送失败"}</span><button type="button" onClick={retry}>重试</button></div>}
      </div>
      {!following && <button className="jump-bottom" type="button" onClick={() => { setFollowing(true); listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }}>回到底部</button>}
      <form className="composer-area" onSubmit={submit}>
        {attachmentError && <p className="form-error" role="alert">{attachmentError}</p>}
        {attachments.length > 0 && <div className="attachment-strip" aria-label="已选择附件">{attachments.map((item) => <span key={item.id}>{item.name}</span>)}</div>}
        <div className="composer-shell"><button type="button" className="attach-button" onClick={() => fileInputRef.current?.click()} disabled={!bootstrap.capabilities.attachments || sessionStatus !== "ready" || !leaseOwned} aria-label="添加附件">＋</button><input ref={fileInputRef} className="visually-hidden" type="file" multiple onChange={chooseFiles}/><textarea rows={1} placeholder={!leaseOwned ? "此会话由其他浏览器控制" : sessionStatus === "ready" ? "输入消息" : "等待连接恢复"} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!bootstrap.capabilities.chat || sessionStatus !== "ready" || !leaseOwned} aria-label="消息内容"/>{turnIsActive ? <button className="stop-button" type="button" onClick={() => { if (activeTurnId && leaseOwned && window.confirm("确定停止当前任务并接管此会话吗？正在执行的任务会被中断。")) cancelMutation.mutate(); }} disabled={cancelMutation.isPending || !leaseOwned || !activeTurnId} aria-label="停止任务并接管"><span/></button> : <button type="submit" disabled={(!draft.trim() && attachments.length === 0) || sendMutation.isPending || sessionStatus !== "ready" || !leaseOwned} aria-label="发送消息"><Icon name="send"/></button>}</div>
      </form></>}
  </section>;
}

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "未有时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDevicePixelRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "未知";
  return String(Math.round(value * 100) / 100);
}

function ProjectSkeleton() {
  return <div className="skeleton-list" aria-label="正在加载项目">{[1,2,3].map((item) => <div className="skeleton-card" key={item}><span/><div><i/><i/></div></div>)}</div>;
}

function ProjectsPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["mobile-projects"], queryFn: getProjects });
  return <section className="page"><header className="topbar"><div><p className="eyebrow">按最近活动排序</p><h1>项目</h1></div><button className="round-button" type="button" aria-label="刷新项目" onClick={() => void query.refetch()}><Icon name="refresh"/></button></header><div className="content-stack">{query.isPending && <ProjectSkeleton/>}{query.isError && <div className="notice-card error-card"><span className="status-symbol danger">!</span><div><h2>项目加载失败</h2><p>{query.error instanceof Error ? query.error.message : "请稍后重试。"}</p><button className="text-button" type="button" onClick={() => void query.refetch()}>再试一次</button></div></div>}{query.data?.data.length === 0 && <div className="empty-section"><Icon name="projects"/><h2>未有项目记录</h2><p>桌面端创建或打开对话后，项目会显示喺呢度。</p></div>}{query.data?.data.map((project) => <button className="project-card" type="button" key={project.id} onClick={() => navigate(`/projects/${project.id}`)}><span className="project-avatar">{project.uncategorized ? "·" : project.name.slice(0,1).toUpperCase()}</span><span className="project-copy"><strong>{project.name}</strong><small>{project.latestThreadTitle || "未有对话"}</small><em>{project.threadCount} 个对话 · {shortTime(project.lastActiveAt)}</em></span><span className="chevron">›</span></button>)}</div></section>;
}

function ProjectThreadsPage() {
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `opencodex-mobile-project-filter:${projectId}`;
  const scrollKey = `opencodex-mobile-project-scroll:${projectId}`;
  const [filter, setFilter] = useState<"all" | "active" | "archived">(() => {
    const value = sessionStorage.getItem(storageKey);
    return value === "active" || value === "archived" ? value : "all";
  });
  const query = useQuery({ queryKey: ["mobile-project-threads", projectId], queryFn: () => getProjectThreads(projectId), enabled: Boolean(projectId) });
  const createMutation = useMutation({
    mutationFn: (requestId: string) => createThread(projectId, requestId),
    onSuccess: async (result) => {
      sessionStorage.setItem("opencodex-mobile-selected-thread", JSON.stringify({ id: result.data.id, title: result.data.title }));
      await queryClient.invalidateQueries({ queryKey: ["mobile-project-threads", projectId] });
      navigate("/");
    },
  });
  const openThread = (id: string, title: string) => {
    sessionStorage.setItem("opencodex-mobile-selected-thread", JSON.stringify({ id, title }));
    navigate("/");
  };
  useEffect(() => {
    sessionStorage.setItem(storageKey, filter);
    const node = scrollRef.current;
    if (node) node.scrollTop = Number(sessionStorage.getItem(scrollKey) || 0);
    return () => { if (node) sessionStorage.setItem(scrollKey, String(node.scrollTop)); };
  }, [filter, scrollKey, storageKey]);
  const threads = query.data?.data.filter((thread) => filter === "all" || thread.status === filter) || [];
  return <section className="page project-detail-page" ref={scrollRef}><header className="topbar detail-topbar"><button className="round-button back-button" type="button" aria-label="返回项目" onClick={() => navigate("/projects")}>‹</button><div><p className="eyebrow">项目对话</p><h1>{query.data?.project.name || "正在加载"}</h1></div><button className="round-button" type="button" aria-label="刷新对话" onClick={() => void query.refetch()}><Icon name="refresh"/></button></header><div className="project-actions"><div className="segment-control" aria-label="筛选对话">{(["all", "active", "archived"] as const).map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "全部" : value === "active" ? "进行中" : "归档"}</button>)}</div><button className="primary-button new-thread-button" type="button" disabled={createMutation.isPending} onClick={() => createMutation.mutate(createMobileRequestId("thread"))}>{createMutation.isPending ? "创建中…" : "新建对话"}</button></div>{createMutation.isError && <p className="form-error" role="alert">{createMutation.error instanceof Error ? createMutation.error.message : "新建对话失败。"}</p>}<div className="content-stack">{query.isPending && <ProjectSkeleton/>}{query.isError && <div className="notice-card error-card"><span className="status-symbol danger">!</span><div><h2>对话加载失败</h2><p>{query.error instanceof Error ? query.error.message : "请稍后重试。"}</p><button className="text-button" type="button" onClick={() => void query.refetch()}>再试一次</button></div></div>}{!query.isPending && !query.isError && threads.length === 0 && <div className="empty-section compact"><h2>呢个筛选未有对话</h2><p>切换筛选条件，或者新建一个对话。</p></div>}{threads.map((thread) => <button className="thread-card" type="button" key={thread.id} onClick={() => openThread(thread.id, thread.title)}><span><strong>{thread.title}</strong><small>{shortTime(thread.updatedAt)}{thread.status === "archived" ? " · 已归档" : thread.status === "active" ? " · 进行中" : ""}</small></span><span className="chevron">›</span></button>)}</div></section>;
}

function SettingsPage({ bootstrap, auth }: { bootstrap: MobileBootstrap; auth: MobileAuthStatus }) {
  const queryClient = useQueryClient();
  const viewport = useViewportSnapshot();
  const mutation = useMutation({ mutationFn: logout, onSuccess: async () => { queryClient.clear(); window.location.assign("/mobile/"); } });
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem("opencodex-mobile-debug") === "1");
  const statusQuery = useQuery({ queryKey: ["app-server-status"], queryFn: getAppServerStatus, refetchInterval: debugMode ? 3_000 : false });
  const logsQuery = useQuery({ queryKey: ["app-server-logs"], queryFn: getAppServerLogs, enabled: debugMode, refetchInterval: debugMode ? 3_000 : false });
  const restartMutation = useMutation({ mutationFn: () => restartAppServer(createMobileRequestId("restart")), onSuccess: () => { void statusQuery.refetch(); void logsQuery.refetch(); } });
  const rows = [
    ["连接", "Gateway 正常"],
    ["Runtime", bootstrap.runtimeVersion],
    ["移动契约", `v${bootstrap.contractVersion}`],
    ["浏览器", browserLabel()],
    ["视口", `${viewport.width} × ${viewport.height} · DPR ${formatDevicePixelRatio(viewport.dpr)}`],
    ["移动版", "v3.0.0"],
    ["认证", auth.authRequired ? "访问密码已启用" : "本机无密码模式"],
  ];
  return <section className="page"><header className="topbar"><div><p className="eyebrow">诊断与偏好</p><h1>设置</h1></div></header><div className="settings-group">{rows.map(([label, value]) => <div className="setting-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}<label className="setting-row"><span>调试模式</span><input type="checkbox" checked={debugMode} onChange={(event) => { setDebugMode(event.target.checked); localStorage.setItem("opencodex-mobile-debug", event.target.checked ? "1" : "0"); }}/></label></div>{debugMode && <div className="settings-group app-server-debug"><div className="debug-heading"><div><span>APP Server 日志</span><small>{statusQuery.data?.data.state || "unknown"} · PID {statusQuery.data?.data.pid || "-"}</small></div><button className="secondary-button" type="button" disabled={restartMutation.isPending} onClick={() => { if (window.confirm("确定重启 App Server 吗？正在执行的任务可能会被中断。")) restartMutation.mutate(); }}>Restart App Server（重启 App Server）</button></div>{restartMutation.isError && <p className="form-error">{restartMutation.error instanceof Error ? restartMutation.error.message : "App Server restart failed."}</p>}<ol className="app-server-logs">{logsQuery.data?.data.map((entry, index) => <li key={`${String(entry.time)}-${index}`}><time>{String(entry.time || "")}</time><strong>{String(entry.event || "unknown")}</strong><small>{String(entry.level || "info")} · PID {String(entry.pid || "-")}</small></li>)}</ol></div>}<div className="settings-actions"><button className="secondary-button" type="button" onClick={() => window.location.reload()}><Icon name="refresh"/>刷新页面</button><button className="danger-button" type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "正在退出…" : "退出登录"}</button></div></section>;
}

function BottomNavigation() {
  const items: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
    { to: "/", label: "对话", icon: "chat", end: true },
    { to: "/projects", label: "项目", icon: "projects" },
    { to: "/settings", label: "设置", icon: "settings" },
  ];
  return <nav className="bottom-nav" aria-label="主导航">{items.map((item) => <NavLink to={item.to} end={item.end} key={item.to} className={({ isActive }) => isActive ? "active" : ""}><Icon name={item.icon}/><span>{item.label}</span></NavLink>)}</nav>;
}

function AuthenticatedApp({ auth }: { auth: MobileAuthStatus }) {
  useViewportCoordinator();
  const bootstrapQuery = useQuery({ queryKey: ["mobile-bootstrap"], queryFn: getBootstrap, refetchInterval: 30_000 });
  if (bootstrapQuery.isPending) return <LoadingScreen/>;
  if (!bootstrapQuery.data) return <main className="center-screen"><div className="status-symbol danger">!</div><h1>无法连接 Gateway</h1><p>{bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : "请检查服务是否正在运行。"}</p><button className="primary-button" type="button" onClick={() => void bootstrapQuery.refetch()}>重新连接</button></main>;
  return <ConnectedShell auth={auth} bootstrap={bootstrapQuery.data}/>;
}

function ConnectedShell({ auth, bootstrap }: { auth: MobileAuthStatus; bootstrap: MobileBootstrap }) {
  const online = useOnlineState();
  const session = useMobileSession(bootstrap, online);
  const expiresAt = auth.expiresAtMs || (bootstrap.sessionExpiresAt ? Date.parse(bootstrap.sessionExpiresAt) : null);
  const expired = session.snapshot.status === "expired" || (expiresAt != null && expiresAt <= Date.now());
  return <CompatibilityGate><div className="app-shell"><ConnectionBanner status={session.snapshot.status} online={online} expired={expired} retry={() => window.location.reload()}/><main className="app-content"><Routes><Route path="/" element={<ChatPage bootstrap={bootstrap} sessionStatus={session.snapshot.status} sessionStore={session.store}/>}/><Route path="/projects" element={<ProjectsPage/>}/><Route path="/projects/:projectId" element={<ProjectThreadsPage/>}/><Route path="/settings" element={<SettingsPage bootstrap={bootstrap} auth={auth}/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></main><BottomNavigation/></div></CompatibilityGate>;
}

export function MobileApp() {
  const authQuery = useQuery({ queryKey: ["mobile-auth"], queryFn: getAuthStatus, refetchInterval: 30_000 });
  if (authQuery.isPending) return <LoadingScreen label="正在检查登录状态"/>;
  if (authQuery.isError) return <main className="center-screen"><div className="status-symbol danger">!</div><h1>Gateway 暂时不可用</h1><p>{authQuery.error instanceof Error ? authQuery.error.message : "请确认服务已启动。"}</p><button className="primary-button" type="button" onClick={() => void authQuery.refetch()}>重试</button></main>;
  if (!authQuery.data.authenticated) return <LoginPage/>;
  return <AuthenticatedApp auth={authQuery.data}/>;
}

interface ErrorBoundaryState { hasError: boolean; diagnosticId: string }
export class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, diagnosticId: "" };
  static getDerivedStateFromError(): ErrorBoundaryState { return { hasError: true, diagnosticId: `mob_${Date.now().toString(36)}` }; }
  componentDidCatch(error: Error, info: ErrorInfo) { reportClientError("mobile_render_error", new Error(`${error.message}\n${info.componentStack || ""}`)); }
  render() {
    if (this.state.hasError) return <main className="center-screen"><div className="status-symbol danger">!</div><h1>页面出现异常</h1><p>诊断编号：{this.state.diagnosticId}</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>刷新页面</button></main>;
    return this.props.children;
  }
}
