(function () {
  const w = window;
  const modificationScope = w.__OpenCodexCurrentProviderScope;
  const modificationEffects = modificationScope?.effects;
  const providerGeneration = modificationScope?.generation || document;
  const adapterHost = w.__OpenCodexAdapterHost;
  const scheduler = adapterHost?.scheduler?.capture?.() || w;
  const pluginSystem = w.OpenCodexPluginSystem || w.__OpenCodexPluginSystem;
  if (!pluginSystem || typeof pluginSystem.registerPlugin !== "function") return;
  const registerPlugin = adapterHost?.plugins?.register
    ? (plugin) => adapterHost.plugins.register(pluginSystem, plugin)
    : pluginSystem.registerPlugin.bind(pluginSystem);
  const sharedAdapterHost = adapterHost;

  const POST_SEND_FOCUS_BLOCK_MS = 4000;
  const MANUAL_FOCUS_MS = 900;

  function isComposerEditableElement(element) {
    return !!(
      element &&
      element.nodeType === 1 &&
      typeof element.matches === "function" &&
      element.matches(".ProseMirror,[contenteditable='true'],textarea,input")
    );
  }

  function scrollableAncestor(element) {
    for (let node = element?.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = w.getComputedStyle ? w.getComputedStyle(node) : null;
      const overflowY = String(style?.overflowY || "");
      if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
  }

  function isPromptSendInvoke(channel, payload) {
    if (channel === "turn:start" || channel === "start-conversation") return true;
    if (channel !== "codex_desktop:message-from-view") return false;
    if (!payload || typeof payload !== "object") return false;
    const request = payload.request && typeof payload.request === "object" ? payload.request : null;
    return !!request && request.method === "turn/start";
  }

  function isIOSWebKitDevice() {
    const nav = w.navigator || {};
    const ua = String(nav.userAgent || "");
    const platform = String(nav.platform || "");
    const touchPoints = Number(nav.maxTouchPoints || 0);
    // iPadOS 桌面 UA 会伪装成 MacIntel，只能结合触控点数识别。
    const isAppleTouchDevice = /iP(?:hone|ad|od)/i.test(ua) || (platform === "MacIntel" && touchPoints > 1);
    return isAppleTouchDevice && /WebKit/i.test(ua) && !/Android/i.test(ua);
  }

  function createViewportCoordinator() {
    const subscribers = new Set();
    const settleTimers = new Map();
    let animationFrame = 0;
    let listening = false;
    let pendingReason = "viewport";
    let lastSnapshot = null;
    let settleGeneration = 0;
    let eventDisposers = [];
    const diagnostics = { dispatches: 0, frameRequests: 0, metricReads: 0 };

    function readSnapshot() {
      diagnostics.metricReads += 1;
      const root = document.documentElement;
      const viewport = w.visualViewport;
      const visualHeight = Math.max(0, Number(viewport?.height || w.innerHeight || root.clientHeight || 0));
      const offsetTop = Math.max(0, Number(viewport?.offsetTop || 0));
      const layoutHeight = Math.max(0, Number(root.clientHeight || w.innerHeight || visualHeight));
      const innerHeight = Math.max(0, Number(w.innerHeight || layoutHeight || visualHeight));
      const screenHeight = Math.max(0, Number(w.screen?.height || 0));
      const screenAvailableHeight = Math.max(0, Number(w.screen?.availHeight || 0));
      return Object.freeze({
        bodyHeight: Math.max(0, Number(document.body?.clientHeight || 0)),
        innerHeight,
        layoutHeight,
        offsetTop,
        screenAvailableHeight,
        screenHeight,
        visualBottom: visualHeight + offsetTop,
        visualHeight,
      });
    }

    function dispatch(reason) {
      if (document.visibilityState === "hidden") return;
      lastSnapshot = readSnapshot();
      diagnostics.dispatches += 1;
      for (const subscriber of Array.from(subscribers)) {
        try {
          subscriber(lastSnapshot, reason);
        } catch (error) {
          console.warn("[opencodex-viewport] subscriber failed", error);
        }
      }
    }

    function cancelScheduledFrame() {
      if (!animationFrame) return;
      if (typeof w.cancelAnimationFrame === "function") scheduler.cancelAnimationFrame(animationFrame);
      else scheduler.clearTimeout(animationFrame);
      animationFrame = 0;
    }

    function clearSettleTimers() {
      settleGeneration += 1;
      for (const timer of settleTimers.values()) scheduler.clearTimeout(timer);
      settleTimers.clear();
    }

    function scheduleSettleDispatches(reason, delays) {
      clearSettleTimers();
      if (delays.length === 0) return;
      const generation = settleGeneration;
      const [firstDelay, ...remainingDelays] = delays;
      const firstTimer = scheduler.setTimeout(() => {
        if (generation !== settleGeneration) return;
        settleTimers.delete(firstDelay);
        // 事件风暴安静到首个校准点后再展开余下时点，热路径始终只反复维护一个 timer。
        for (const delay of remainingDelays) {
          const timer = scheduler.setTimeout(() => {
            if (generation !== settleGeneration) return;
            settleTimers.delete(delay);
            dispatch(`${reason}:settle`);
          }, Math.max(0, delay - firstDelay));
          settleTimers.set(delay, timer);
        }
        dispatch(`${reason}:settle`);
      }, firstDelay);
      settleTimers.set(firstDelay, firstTimer);
    }

    function request(reason = "viewport", options = {}) {
      if (document.visibilityState === "hidden") {
        cancelScheduledFrame();
        clearSettleTimers();
        return;
      }
      const immediate = options.immediate === true;
      const delays = Array.from(new Set(options.settleDelays || []))
        .map(Number)
        .filter((delay) => Number.isFinite(delay) && delay >= 0)
        .sort((left, right) => left - right);
      // 同一帧内的 resize/scroll 风暴只保留一次前沿测量，帧尾再统一确认最终几何值。
      if (immediate && !animationFrame) dispatch(reason);
      pendingReason = reason;
      if (!animationFrame) {
        diagnostics.frameRequests += 1;
        const run = () => {
          animationFrame = 0;
          dispatch(pendingReason);
        };
        animationFrame =
          typeof w.requestAnimationFrame === "function" ? scheduler.requestAnimationFrame(run) : scheduler.setTimeout(run, 0);
      }
      if (delays.length > 0) {
        // 连续 visualViewport 事件只保留最后一组稳定期校准，避免每个事件累积多轮定时任务。
        scheduleSettleDispatches(reason, delays);
      }
    }

    const requestViewportTransition = () =>
      request("viewport", { immediate: true, settleDelays: [80, 240, 260, 600] });
    const requestOrientationTransition = () =>
      request("orientationchange", { immediate: true, settleDelays: [80, 240, 260, 600] });
    const requestFocusIn = () =>
      request("focusin", { immediate: true, settleDelays: [80, 240, 260, 600] });
    const requestFocusOut = () =>
      request("focusout", { immediate: true, settleDelays: [80, 240, 260, 600] });
    const requestInput = () => request("input");
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        request("visibility", { immediate: true, settleDelays: [80, 260] });
      } else {
        cancelScheduledFrame();
        clearSettleTimers();
      }
    };

    function startListening() {
      if (listening || !sharedAdapterHost?.events?.observe) return;
      listening = true;
      const observe = (target, type, callback, options = {}) => {
        if (!target) return;
        eventDisposers.push(sharedAdapterHost.events.observe({ key: {}, target, type, callback, ...options }));
      };
      observe(w, "resize", requestViewportTransition, { passive: true });
      // 单独保留旋转原因，订阅方可丢弃旧方向的稳定高度，避免把横竖屏差值误判成键盘。
      observe(w, "orientationchange", requestOrientationTransition, { passive: true });
      observe(w.visualViewport, "resize", requestViewportTransition, { passive: true });
      observe(w.visualViewport, "scroll", requestViewportTransition, { passive: true });
      observe(document, "focusin", requestFocusIn, { capture: true });
      observe(document, "focusout", requestFocusOut, { capture: true });
      observe(document, "input", requestInput, { capture: true });
      observe(document, "visibilitychange", handleVisibility);
    }

    function stopListening() {
      if (!listening) return;
      listening = false;
      for (const disposeEvent of eventDisposers.reverse()) disposeEvent();
      eventDisposers = [];
      cancelScheduledFrame();
      clearSettleTimers();
      // 无订阅期间屏幕仍可能旋转或被浏览器工具栏改变；再次启用时必须重新读取真实尺寸。
      lastSnapshot = null;
    }

    return Object.freeze({
      get diagnostics() {
        return { ...diagnostics, subscribers: subscribers.size };
      },
      request,
      snapshot() {
        return lastSnapshot || readSnapshot();
      },
      subscribe(subscriber) {
        if (typeof subscriber !== "function") return () => {};
        subscribers.add(subscriber);
        startListening();
        // 第二个移动插件直接复用第一份初始快照，避免激活阶段重复读取布局尺寸。
        lastSnapshot ||= readSnapshot();
        subscriber(lastSnapshot, "subscribe");
        return () => {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) stopListening();
        };
      },
    });
  }

  // 两个移动插件共享同一个事件源和布局快照，避免 iOS 上重复读取 visualViewport 和根节点尺寸。
  if (w.__OpenCodexViewportCoordinatorGeneration !== providerGeneration) {
    w.__OpenCodexViewportCoordinator = createViewportCoordinator();
    w.__OpenCodexViewportCoordinatorGeneration = providerGeneration;
  }
  const viewportCoordinator = w.__OpenCodexViewportCoordinator;

  function viewportInsets(snapshot, keyboardFocused, stableVisualHeight = 0) {
    const DEFAULT_ANDROID_BROWSER_CHROME_INSET = 64;
    const visualBottom = Math.max(0, Number(snapshot?.visualBottom || 0));
    const innerHeight = Math.max(0, Number(snapshot?.innerHeight || 0));
    const layoutGap = Math.max(0, innerHeight - visualBottom);
    const screenHeight = Math.max(0, Number(snapshot?.screenHeight || 0));
    const availableHeight = Math.max(0, Number(snapshot?.screenAvailableHeight || 0));
    const systemUiInset = availableHeight > 0 ? Math.max(0, screenHeight - availableHeight) : 0;
    const screenGap = screenHeight > 0 ? Math.max(0, screenHeight - visualBottom - systemUiInset) : 0;
    const focusedHeightDrop = keyboardFocused
      ? Math.max(0, Number(stableVisualHeight || 0) - Math.max(0, Number(snapshot?.visualHeight || 0)))
      : 0;
    // Android 键盘通常令可视区缩短超过 120px；浏览器工具栏则应是较小、稳定的差值。
    // Chromium 有时令 innerHeight 同 visualViewport 一齐缩细，layoutGap 会保持 0；
    // 需要同未聚焦时稳定高度比较，先唔会把键盘误当成浏览器底栏再留一层空白。
    const keyboardVisible = layoutGap >= 120 || (keyboardFocused && (layoutGap >= 80 || focusedHeightDrop >= 80));
    const browserChromeInset = keyboardVisible
      ? 0
      : Math.min(160, screenGap || layoutGap || DEFAULT_ANDROID_BROWSER_CHROME_INSET);
    return Object.freeze({
      browserChromeInset: Math.max(0, Math.floor(browserChromeInset)),
      keyboardInset: Math.max(0, Math.floor(Math.max(layoutGap, focusedHeightDrop))),
      keyboardVisible,
    });
  }
  // 仅暴露无敏感数据的几何诊断，方便隔离浏览器回归测试核对底栏/键盘判定。
  w.__OpenCodexMobileViewportMetrics = Object.freeze({ viewportInsets });

  registerPlugin({
    id: "opencodex.mobile-keyboard-optimization",
    name: "Mobile keyboard optimization",
    labelKey: "plugin.mobileKeyboardOptimization.label",
    label: "移动端软键盘优化",
    descKey: "plugin.mobileKeyboardOptimization.desc",
    desc: "优化移动端输入框聚焦和视口高度，减少软键盘遮挡。",
    enableStorageKey: "mobileKeyboardOptimization",
    defaultEnabled: true,
    builtin: true,
    order: 10,
    activate(context) {
      const narrowViewport = () => {
        const width = Number(w.innerWidth || document.documentElement?.clientWidth || 0);
        if (width > 0 && width <= 820) return true;
        try {
          return !!w.matchMedia?.("(pointer: coarse)")?.matches;
        } catch {
          return false;
        }
      };
      if (
        context.scope !== "renderer" ||
        !document ||
        document.__opencodexMobileKeyboardPluginInstalled ||
        !adapterHost?.events?.observe ||
        !adapterHost?.hooks?.around
      ) {
        // 先安装轻量视口监听；桌面端缩到 F12 手机宽度后，插件才可以即时切换到移动排版。
        return null;
      }
      document.__opencodexMobileKeyboardPluginInstalled = true;

      let focusBlockedUntilMs = 0;
      let lastManualFocusIntentAtMs = 0;
      let stableUnfocusedVisualHeight = 0;

      const isEnabled = () => context.plugin.isEnabled();
      // 桌面瀏覽器縮到手機寬度時都要套用移動版排版，方便調試亦同真機一致。
      const isMobile = () => !!context.platform.isMobile() || narrowViewport();

      const setDatasetValue = (root, key, value) => {
        if (root.dataset[key] !== value) root.dataset[key] = value;
      };

      const setStyleValue = (root, name, value) => {
        if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
      };

      const style = document.createElement("style");
      style.id = "opencodex-mobile-keyboard-plugin-styles";
      style.textContent = `
        @media (max-width: 820px), (pointer: coarse) {
          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]),
          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) body,
          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) #root {
            height: var(--codex-visual-viewport-height, 100dvh) !important;
            min-height: var(--codex-visual-viewport-height, 100dvh) !important;
            max-height: var(--codex-visual-viewport-height, 100dvh) !important;
            overflow: hidden;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"] body {
            width: 100%;
            touch-action: pan-x pan-y;
            overscroll-behavior: none;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"] input,
          html[data-opencodex-mobile-keyboard-optimization="true"] textarea,
          html[data-opencodex-mobile-keyboard-optimization="true"] [contenteditable="true"],
          html[data-opencodex-mobile-keyboard-optimization="true"] .ProseMirror {
            font-size: max(16px, 1em) !important;
            scroll-margin-bottom: calc(var(--codex-keyboard-inset-bottom, 0px) + 96px);
          }

          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) [data-app-shell-main-content-layout],
          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) .app-shell-main-content-viewport {
            /* Android 浏览器底栏不属于 layout viewport；把测得的安全区交给 floating footer。 */
            --thread-floating-content-bottom-inset: calc(var(--spacing, 4px) * 3 + var(--codex-browser-chrome-inset-bottom, 0px));
            min-width: 0 !important;
            width: 100% !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"][data-opencodex-android-keyboard-visible="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) [data-app-shell-main-content-layout],
          html[data-opencodex-mobile-keyboard-optimization="true"][data-opencodex-android-keyboard-visible="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) .app-shell-main-content-viewport {
            /* 鍵盤令 visual viewport 收縮時，footer 避让键盘，增加足够间距避免输入框被遮挡。 */
            --thread-floating-content-bottom-inset: calc(var(--spacing, 4px) * 6) !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-android-keyboard-visible="true"]):not([data-opencodex-ios-keyboard-optimization="true"]) [data-app-shell-main-content-layout],
          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-android-keyboard-visible="true"]):not([data-opencodex-ios-keyboard-optimization="true"]) .app-shell-main-content-viewport {
            /* 鍵盤關閉時，避免浏覽器底栏遮挡对话框，增加更多預留空間。 */
            --thread-floating-content-bottom-inset: calc(var(--spacing, 4px) * 6 + 60px) !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"][data-opencodex-android-keyboard-visible="true"] [data-thread-scroll-footer="true"] {
            margin-bottom: 0 !important;
            padding-bottom: 0 !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) main[data-app-shell-main-surface],
          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) [data-app-shell-workspace-layout],
          html[data-opencodex-mobile-keyboard-optimization="true"]:not([data-opencodex-ios-keyboard-optimization="true"]) .app-shell-main-content-frame {
            box-sizing: border-box !important;
            min-width: 0 !important;
            width: 100% !important;
            overflow-x: hidden !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"] header[data-app-shell-header-edge-scroll] {
            box-sizing: border-box !important;
            min-width: 0 !important;
            max-width: 100% !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"] .app-shell-left-panel {
            /* 窄屏左右欄用 overlay，唔可以再壓縮主會話區。 */
            background: var(--surface-primary, #fff) !important;
          }

          /* 官方部分版本會將 sidebar trigger 標成 hidden；窄屏下仍要保留可操作入口。 */
          html[data-opencodex-mobile-keyboard-optimization="true"] button[data-app-shell-sidebar-trigger] {
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"] .app-shell-left-panel[data-opencodex-mobile-left-panel-overlay="true"] {
            box-sizing: border-box !important;
            width: min(88vw, 320px) !important;
            max-width: 88vw !important;
            min-width: 0 !important;
            position: fixed !important;
            inset-block: 0 !important;
            inset-inline-start: 0 !important;
            z-index: 40 !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
          }

          html[data-opencodex-mobile-keyboard-optimization="true"] [data-opencodex-mobile-right-panel-overlay="true"] {
            /* 移動端右欄用 overlay，唔參與主內容 flex 寬度。右欄 z-index 提高避免同左欄重疊。 */
            position: fixed !important;
            inset-block: 0 !important;
            inset-inline-end: 0 !important;
            width: min(88vw, 420px) !important;
            max-width: 88vw !important;
            z-index: 40 !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
          }

          html[data-opencodex-ios-keyboard-optimization="true"] {
            /* iOS 下同时避让 Safari 底栏/软键盘和 Home Indicator 安全区。 */
            --codex-ios-bottom-avoidance: max(var(--codex-keyboard-inset-bottom, 0px), env(safe-area-inset-bottom, 0px));
          }

          html[data-opencodex-ios-keyboard-optimization="true"] [data-app-shell-main-content-layout],
          html[data-opencodex-ios-keyboard-optimization="true"] .app-shell-main-content-viewport {
            --thread-floating-content-bottom-inset: calc(var(--spacing, 4px) * 3 + var(--codex-ios-bottom-avoidance, 0px));
          }

          html[data-opencodex-ios-keyboard-optimization="true"] [data-thread-find-composer="true"] {
            transform: translate3d(0, calc(-1 * var(--codex-ios-bottom-avoidance, 0px)), 0);
          }
        }
      `;
      (document.head || document.documentElement).appendChild(style);

      const syncEnabledState = () => {
        const enabled = isEnabled();
        const root = document.documentElement;
        setDatasetValue(root, "opencodexMobileKeyboardOptimization", enabled ? "true" : "false");
        setDatasetValue(
          root,
          "opencodexIosKeyboardOptimization",
          enabled && isMobile() && isIOSWebKitDevice() ? "true" : "false"
        );
        if (!enabled) {
          root.style.removeProperty("--codex-visual-viewport-height");
          root.style.removeProperty("--codex-visual-viewport-offset-top");
          root.style.removeProperty("--codex-keyboard-inset-bottom");
          root.style.removeProperty("--codex-browser-chrome-inset-bottom");
          root.style.removeProperty("--opencodex-left-panel-width");
          root.style.removeProperty("--opencodex-right-panel-width");
          root.style.removeProperty("--opencodex-content-inline-inset");
          root.removeAttribute("data-opencodex-android-keyboard-visible");
        }
        return enabled;
      };

      const setViewportVars = (snapshot = viewportCoordinator.snapshot()) => {
        if (!syncEnabledState()) return;
        const height = Math.max(0, Math.floor(snapshot.visualHeight));
        const offsetTop = Math.max(0, Math.floor(snapshot.offsetTop));
        const layoutHeight = Math.max(0, Math.floor(snapshot.layoutHeight || height));
        const innerHeight = Math.max(0, Math.floor(snapshot.innerHeight || layoutHeight || height));
        const viewportBottom = Math.max(0, Math.floor(snapshot.visualBottom));
        // iOS Safari 的地址栏和软键盘不会稳定改写布局视口；用可视视口底部差值推导被遮挡高度。
        const keyboardInset = isIOSWebKitDevice()
          ? Math.max(0, layoutHeight - viewportBottom, innerHeight - viewportBottom)
          : Math.max(0, innerHeight - viewportBottom);
        const keyboardFocused = isComposerEditableElement(document.activeElement);
        if (!keyboardFocused && height > 0) stableUnfocusedVisualHeight = height;
        const insets = viewportInsets(snapshot, keyboardFocused, stableUnfocusedVisualHeight);
        const root = document.documentElement;
        if (height > 0) setStyleValue(root, "--codex-visual-viewport-height", `${height}px`);
        setStyleValue(root, "--codex-visual-viewport-offset-top", `${offsetTop}px`);
        setStyleValue(root, "--codex-keyboard-inset-bottom", `${keyboardInset}px`);
        setStyleValue(root, "--codex-browser-chrome-inset-bottom", `${isIOSWebKitDevice() ? 0 : insets.browserChromeInset}px`);
        setDatasetValue(root, "opencodexAndroidKeyboardVisible", !isIOSWebKitDevice() && insets.keyboardVisible ? "true" : "false");
        modificationEffects?.primary?.emit();
      };

      const panelIsHidden = (panel) => {
        const ariaHidden = String(panel?.getAttribute?.("aria-hidden") || "").toLowerCase();
        const state = String(panel?.getAttribute?.("data-state") || "").toLowerCase();
        return ariaHidden === "true" || state === "closed" || state === "hidden";
      };

      let lastLeftPanelState = null;
      let lastRightPanelState = null;
      let preferredPanel = null;
      let exclusionTimer = 0;
      let exclusionRetryCount = 0;

      const visibleButton = (selector) => Array.from(document.querySelectorAll(selector)).find((button) => {
        const rect = button.getBoundingClientRect?.();
        const style = w.getComputedStyle?.(button);
        return rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
      });

      const fallbackButton = (selector) => Array.from(document.querySelectorAll(selector)).find((button) => {
        const rect = button.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0 && !button.disabled;
      });

      const leftToggleButton = () =>
        visibleButton("button[data-app-shell-sidebar-trigger], button[aria-label='Hide sidebar'], button[aria-label='Show sidebar']") ||
        fallbackButton("button[data-app-shell-sidebar-trigger], button[aria-label='Hide sidebar'], button[aria-label='Show sidebar']");
      const rightToggleButton = () =>
        visibleButton("button[aria-label='Toggle side panel']") || fallbackButton("button[aria-label='Toggle side panel']");

      const clickOfficialToggle = (button) => {
        if (!button || typeof button.click !== "function") return false;
        button.click();
        modificationEffects?.primary?.emit();
        return true;
      };

      const panelState = () => {
        const left = document.querySelector(".app-shell-left-panel");
        const right = document.querySelector("aside[data-app-shell-focus-area='right-panel']");
        const visible = (panel) => {
          if (!panel || panelIsHidden(panel)) return false;
          const rect = panel.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        return { left, right, leftVisible: visible(left), rightVisible: visible(right) };
      };

      const enforcePanelExclusion = () => {
        exclusionTimer = 0;
        if (!isMobile()) return;
        const state = panelState();
        if (!state.leftVisible || !state.rightVisible) {
          // panel 展開有 transition，首個 0ms 幾何值可能仍然係 0；短暫重試避免互斥漏判。
          if (exclusionRetryCount < 3) {
            exclusionRetryCount += 1;
            exclusionTimer = scheduler.setTimeout(enforcePanelExclusion, 80);
          }
          return;
        }
        exclusionRetryCount = 0;
        // 只透過官方按鈕關閉另一欄，唔直接改 React 控制嘅 DOM 狀態。
        if (preferredPanel === "right") {
          clickOfficialToggle(leftToggleButton());
        } else {
          clickOfficialToggle(rightToggleButton());
        }
      };

      const schedulePanelExclusion = (preferred) => {
        preferredPanel = preferred || preferredPanel;
        exclusionRetryCount = 0;
        if (exclusionTimer) scheduler.clearTimeout(exclusionTimer);
        exclusionTimer = scheduler.setTimeout(enforcePanelExclusion, 0);
      };

      const syncLeftPanelState = () => {
        const leftPanel = document.querySelector('.app-shell-left-panel');
        if (!leftPanel || typeof leftPanel.getBoundingClientRect !== "function") {
          document.documentElement.removeAttribute("data-opencodex-left-panel-visible");
          return;
        }
        const rect = leftPanel.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && !panelIsHidden(leftPanel);
        const isMobileView = isMobile();

        // 设置左侧栏可见状态到 html 元素
        if (visible && isMobileView) {
          document.documentElement.setAttribute("data-opencodex-left-panel-visible", "true");
          leftPanel.setAttribute("data-opencodex-mobile-left-panel-overlay", "true");
        } else {
          document.documentElement.removeAttribute("data-opencodex-left-panel-visible");
          leftPanel.removeAttribute("data-opencodex-mobile-left-panel-overlay");
        }
        lastLeftPanelState = visible;
      };

      const syncRightPanelMode = () => {
        const panel = document.querySelector('aside[data-app-shell-focus-area="right-panel"]');
        if (!panel || typeof panel.getBoundingClientRect !== "function") {
          document.documentElement.removeAttribute("data-opencodex-right-panel-visible");
          return;
        }
        const rect = panel.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && !panelIsHidden(panel);
        const isMobileView = isMobile();
        if (visible && isMobileView) {
          panel.setAttribute("data-opencodex-mobile-right-panel-overlay", "true");
          document.documentElement.setAttribute("data-opencodex-right-panel-visible", "true");
        } else {
          panel.removeAttribute("data-opencodex-mobile-right-panel-overlay");
          document.documentElement.removeAttribute("data-opencodex-right-panel-visible");
        }

        lastRightPanelState = visible;
      };

      const panelWidth = (selector, edge) => {
        const panel = document.querySelector(selector);
        if (!panel || typeof panel.getBoundingClientRect !== "function") return 0;
        if (panel.matches?.('[data-opencodex-mobile-right-panel-overlay="true"]')) return 0;
        const rect = panel.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return 0;
        const panelStyle = w.getComputedStyle ? w.getComputedStyle(panel) : null;
        if (panelStyle && /^(fixed|absolute|sticky)$/.test(String(panelStyle.position || ""))) return 0;
        if (edge === "left" && rect.left > 1) return 0;
        if (edge === "right" && rect.right < (w.innerWidth || 0) - 1) return 0;
        return Math.max(0, Math.ceil(rect.width));
      };

      const syncPanelGeometry = () => {
        if (!isEnabled() || !isMobile()) return;
        syncLeftPanelState();
        syncRightPanelMode();
        const state = panelState();
        if (state.leftVisible && state.rightVisible) schedulePanelExclusion(preferredPanel);

        const root = document.documentElement;
        // 移动端左右侧栏都用 overlay 模式，主内容区不需要适应区域改变
        // 参考百度文心设计：侧栏覆盖在主内容区上方，不影响布局
        const leftWidth = 0;  // 始终为 0，因为左侧栏使用 fixed overlay
        const rightWidth = 0; // 始终为 0，因为右侧栏使用 fixed overlay
        setStyleValue(root, "--opencodex-left-panel-width", `${leftWidth}px`);
        setStyleValue(root, "--opencodex-right-panel-width", `${rightWidth}px`);
        setStyleValue(root, "--opencodex-content-inline-inset", `${leftWidth + rightWidth}px`);
      };

      let geometryTimer = 0;
      const schedulePanelGeometry = () => {
        if (geometryTimer) scheduler.clearTimeout(geometryTimer);
        geometryTimer = scheduler.setTimeout(() => {
          geometryTimer = 0;
          syncPanelGeometry();
        }, 80);
      };

      const disposeGeometryObservation = adapterHost.dom?.observe
        ? adapterHost.dom.observe({
            key: {},
            root: document.body || document.documentElement,
            options: { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "aria-hidden", "data-state"] },
            callback: schedulePanelGeometry,
          })
        : () => {};
      let geometryResizeObserver = null;
      if (typeof w.ResizeObserver === "function") {
        geometryResizeObserver = new w.ResizeObserver(schedulePanelGeometry);
        geometryResizeObserver.observe(document.documentElement);
      }

      const keepActiveInputVisible = (snapshot = viewportCoordinator.snapshot()) => {
        if (!isEnabled() || !isMobile()) return;
        const active = document.activeElement;
        if (!isComposerEditableElement(active)) return;
        const visibleTop = Math.max(0, snapshot.offsetTop || 0);
        const visibleBottom = Math.max(visibleTop, snapshot.visualBottom || 0);
        if (visibleBottom <= visibleTop) return;

        const rect = active.getBoundingClientRect();
        const bottomLimit = visibleBottom - 18;
        const topLimit = visibleTop + 8;
        let delta = 0;
        if (rect.bottom > bottomLimit) {
          delta = rect.bottom - bottomLimit;
        } else if (rect.top < topLimit) {
          delta = rect.top - topLimit;
        }
        if (Math.abs(delta) < 1) return;

        const scroller = scrollableAncestor(active);
        if (scroller) {
          scroller.scrollTop += delta;
          return;
        }
        try {
          w.scrollBy(0, delta);
        } catch {}
      };

      const scheduleViewportUpdate = () => {
        viewportCoordinator.request("mobile-plugin", { immediate: true, settleDelays: [80, 240] });
      };

      const disposeViewport = viewportCoordinator.subscribe((snapshot) => {
        setViewportVars(snapshot);
        keepActiveInputVisible(snapshot);
        syncPanelGeometry();
      });

      const preventZoomGesture = (event) => {
        if (!isEnabled() || !isMobile()) return;
        if (event.touches && event.touches.length < 2) return;
        event.preventDefault();
        modificationEffects?.primary?.emit();
      };

      const rememberManualFocusIntent = (event) => {
        const target = event && event.target;
        if (!target || typeof target.closest !== "function") return;
        if (target.closest(".ProseMirror,[contenteditable='true'],textarea,input")) {
          lastManualFocusIntentAtMs = Date.now();
        }
      };

      const shouldSuppressFocus = (element) => {
        if (!isEnabled() || !isMobile()) return false;
        const now = Date.now();
        if (now > focusBlockedUntilMs) return false;
        if (!isComposerEditableElement(element)) return false;
        return now - lastManualFocusIntentAtMs > MANUAL_FOCUS_MS;
      };

      const proto = w.HTMLElement && w.HTMLElement.prototype;
      const disposeFocusHook = proto && typeof proto.focus === "function"
        ? adapterHost.hooks.around({
            key: {},
            target: proto,
            property: "focus",
            handle(thisValue, args, proceed) {
              if (shouldSuppressFocus(thisValue)) {
                modificationEffects?.primary?.emit();
                return;
              }
              return proceed(args);
            },
          })
        : () => {};

      const disposePreference = context.events.on("plugin:enabled-changed", (payload) => {
        if (payload && payload.id === context.plugin.id) scheduleViewportUpdate();
      });
      const disposeIpcInvoke = context.events.on("ipc:invoke", (event) => {
        if (isEnabled() && isMobile() && isPromptSendInvoke(event?.channel, event?.payload)) {
          focusBlockedUntilMs = Date.now() + POST_SEND_FOCUS_BLOCK_MS;
        }
      });

      const eventDisposers = [
        adapterHost.events.observe({ key: {}, target: document, type: "touchmove", passive: false, callback: preventZoomGesture }),
        adapterHost.events.observe({ key: {}, target: document, type: "gesturestart", passive: false, callback: preventZoomGesture }),
        adapterHost.events.observe({ key: {}, target: document, type: "gesturechange", passive: false, callback: preventZoomGesture }),
        adapterHost.events.observe({ key: {}, target: document, type: "pointerdown", capture: true, callback: rememberManualFocusIntent }),
        adapterHost.events.observe({ key: {}, target: document, type: "touchstart", capture: true, callback: rememberManualFocusIntent }),
        adapterHost.events.observe({
          key: {}, target: document, type: "click", capture: true,
          callback: (event) => {
            const button = event.target?.closest?.("button");
            if (!button || !isMobile()) return;
            if (button.matches("button[aria-label='Toggle side panel']")) {
              syncPanelGeometry();
              schedulePanelExclusion("right");
            } else if (button.matches("button[data-app-shell-sidebar-trigger], button[aria-label='Hide sidebar'], button[aria-label='Show sidebar']")) {
              syncPanelGeometry();
              schedulePanelExclusion("left");
            }
          },
        }),
      ];

      return () => {
        disposePreference();
        disposeIpcInvoke();
        disposeViewport();
        if (geometryTimer) scheduler.clearTimeout(geometryTimer);
        if (exclusionTimer) scheduler.clearTimeout(exclusionTimer);
        exclusionRetryCount = 0;
        disposeGeometryObservation();
        geometryResizeObserver?.disconnect();
        disposeFocusHook();
        for (const disposeEvent of eventDisposers.reverse()) disposeEvent();
        if (style.parentNode) style.parentNode.removeChild(style);
        document.documentElement.removeAttribute("data-opencodex-mobile-keyboard-optimization");
        document.documentElement.removeAttribute("data-opencodex-ios-keyboard-optimization");
        document.documentElement.style.removeProperty("--codex-visual-viewport-height");
        document.documentElement.style.removeProperty("--codex-visual-viewport-offset-top");
        document.documentElement.style.removeProperty("--codex-keyboard-inset-bottom");
        document.documentElement.style.removeProperty("--codex-browser-chrome-inset-bottom");
        document.documentElement.style.removeProperty("--opencodex-left-panel-width");
        document.documentElement.style.removeProperty("--opencodex-right-panel-width");
        document.documentElement.style.removeProperty("--opencodex-content-inline-inset");
        document.documentElement.removeAttribute("data-opencodex-android-keyboard-visible");
        document.querySelectorAll?.('[data-opencodex-mobile-right-panel-overlay="true"]').forEach((panel) => {
          panel.removeAttribute("data-opencodex-mobile-right-panel-overlay");
        });
        document.querySelectorAll?.('[data-opencodex-mobile-left-panel-overlay="true"]').forEach((panel) => {
          panel.removeAttribute("data-opencodex-mobile-left-panel-overlay");
        });
        document.__opencodexMobileKeyboardPluginInstalled = false;
      };
    },
  });
})();
