# OpenCodex

**Public version: v3.0.0** · [Source repository](https://github.com/l96848693/OpenCodex) · [AGPL-3.0 license](../LICENSE)

[繁體中文（粵語）](../README.md) | [简体中文](README_CN.md) | **English** | [Release notes](NEWS.md)

OpenCodex is a middleware layer between the Codex desktop runtime and the browser. It supports legacy Codex Desktop and the newer ChatGPT Desktop runtime, allowing you to operate Codex on a target computer from a phone, tablet, or another computer without staying at the desk.

---

The ChatGPT app is not always convenient in the mainland China Android ecosystem, so this project continues to build on the original OpenCodex foundation.

OpenCodex remains useful in several scenarios:

1. It now provides a dedicated Mobile Web interface instead of squeezing the desktop three-column layout onto a phone.
2. It does not require an overseas Google Play or Apple account and supports remote use with third-party API login.
3. PC Web preserves the familiar Codex experience, including the file tree, terminal, and review features.
4. It can be paired with Tailscale, ZeroTier, a VPN, or a private tunnel without relying on the official relay, giving you more control over latency and privacy.

---

## Features

- Operate Codex on the target computer through a browser from phones, tablets, and computers.
- Preserve the familiar Codex experience on PC Web.
- Provide a dedicated `/mobile/` interface designed for narrow screens, touch input, soft keyboards, and orientation changes.
- Support local, LAN, and remote-LAN access through Tailscale, ZeroTier, or a VPN.
- Protect access with a password.
- Configure the listen address, port, and password through a desktop launcher.
- Browse projects and sessions, page through turns, receive streaming items, stop tasks, upload attachments, and inspect connection state on Mobile Web.
- Keep the Gateway isolated from the official Electron runtime without modifying the official installation directory.
- Load built-in and external ESM plugins on PC Web through Plugin SDK v2.
- The tested scope is primarily the Windows Gateway, Android Mobile Web, and Samsung Galaxy S20/S20 Ultra; this version is hardened for those environments.
- macOS, Safari (including iOS Safari), and other Apple-native browsers have not been tested, so compatibility is not guaranteed.

## Requirements

- Node.js
- pnpm
- Legacy Codex Desktop or the newer ChatGPT Desktop app with Codex installed locally. It does not need to be running beforehand and may run alongside OpenCodex.
- Windows, macOS, or Linux. Linux currently uses command-line startup.

## Getting Started

### Desktop Launcher

Download an installer from the Release page, or run the launcher locally:

```bash
pnpm install
pnpm run launcher:dev
```

Build installers:

```bash
pnpm run launcher:dist:mac
pnpm run launcher:dist:win
```

Artifacts are written to `release/`. On first launch, OpenCodex selects an available port. Changing the listen address, port, or access password causes the Launcher to restart the Gateway and apply the new configuration.

### Command-Line Startup

Bash, macOS, and Linux:

```bash
pnpm install
HOST=127.0.0.1 PORT=3737 pnpm run web:dev
```

Windows PowerShell must use PowerShell environment-variable syntax:

```powershell
pnpm install
$env:HOST = "127.0.0.1"
$env:PORT = "3737"
pnpm run web:dev
```

To allow access from a phone over the LAN or Tailscale:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "39289"
pnpm run web:dev
```

The first run builds the project and prepares the official Electron runtime. The service is ready only after the log prints `Gateway listening`; an `esbuild` message, download progress, or `retrying` message does not mean startup has completed.

Check the port and health endpoint from PowerShell:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3737 -ErrorAction SilentlyContinue
Invoke-RestMethod http://127.0.0.1:3737/api/health | Select-Object ok,gateway
```

Open these URLs after startup:

```text
PC Web: http://127.0.0.1:3737/
Mobile Web: http://127.0.0.1:3737/mobile/
```

### Set an Access Password

Setting a password is strongly recommended. A non-default port is also recommended for remote access. Copy the example configuration first:

```bash
cp config.example.yaml config.yaml
```

```yaml
auth:
  password: "your-password"
```

### Stop the Development Service

`pnpm run web:dev` runs the Gateway in the foreground. Return to that terminal and press `Ctrl+C` to stop it; no separate shutdown command is required.

Run only one OpenCodex Gateway on a computer whenever possible. Development on port 3737 and testing on port 39289 may still share the official Electron runner cache even though the ports differ. The second Gateway then reports `ERR_OPENCODEX_RUNTIME_IN_USE`. Stop the original Gateway normally before switching environments. Do not terminate the official Codex process or delete the runtime cache.

If the original terminal is gone, identify only this project's development runner before stopping it:

```powershell
$runner = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*OpenCodex*gateway\dev\run-gateway.cjs*"
}
$runner | Select-Object ProcessId,CommandLine
$runner | ForEach-Object { Stop-Process -Id $_.ProcessId }
```

### Linux

There is currently no prebuilt Linux Launcher. Follow the [Linux setup guide](LINUX_GUIDE_EN.md) and start OpenCodex from the command line.

### Remote Access

OpenCodex does not provide a remote networking service. Use Tailscale, ZeroTier, Cloudflare Tunnel, a company VPN, or a similar solution, then enable LAN mode in the Launcher.

Direct public exposure is possible but not recommended. A controlled network plus an access password is safer.

## Mobile Web Behavior

- Opening a session initially loads the latest five turns, ordered from oldest to newest, and positions the view at the latest content.
- Pulling down again at the top loads five older turns at a time, up to 50 automatically displayed turns.
- Very large items are not silently truncated; the interface provides a Load More action.
- A turn still running in the official desktop runtime is shown as Streaming, and new items continue to appear.
- During streaming, the send button becomes a stop button. Stopping the current task requires confirmation.
- Five minutes of Web inactivity releases the Web lease without interrupting a turn still running in the official backend. Reconnecting can reacquire control when no other browser has taken the lease.

## Common Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Command-line Gateway listen address. |
| `PORT` | `3737` | Command-line Gateway listen port. |
| `OPENCODEX_HOST` | `127.0.0.1` | Default address used by the Launcher on first startup. |
| `OPENCODEX_PORT` | Random available port | Default port used by the Launcher on first startup. |
| `OPENCODEX_PREFERRED_LANGUAGES` | `zh-CN` | Preferred OpenCodex UI languages as a JSON array or comma-separated list. |
| `OPENCODEX_PLUGIN_DIRS` | Empty | External plugin roots, separated by the platform path delimiter or supplied as a JSON array. |
| `OPENCODEX_LOG_MAX_MB` | `10` | Maximum size of `gateway.log`; one additional `gateway.log.old` is retained. |
| `CODEX_WEB_CONFIG_PATH` | `config.yaml` | Gateway authentication configuration path. |
| `CODEX_WEB_AUTH_TOKEN_TTL_MS` | `43200000` | Gateway access-token lifetime; 12 hours by default. |
| `CODEX_WEB_DEBUG` | Empty | Set to `1` or `true` for additional diagnostics. |
| `CODEX_WEB_SLOW_LOG_MS` | `750` | Slow IPC call threshold in milliseconds. |
| `CODEX_WEB_LOCAL_FILE_TOKEN_TTL_MS` | `300000` | Local file preview URL token lifetime. |
| `CODEX_DESKTOP_APP_PATH` | Auto scan | Codex or ChatGPT Desktop path, or a path containing `app.asar`. |
| `CODEX_DESKTOP_EXECUTABLE_PATH` | Auto scan | Official Electron executable override on Windows or Linux. |
| `CODEX_APP_SERVER_BINARY_PATH` | Auto scan | Codex app-server or CLI executable override on Windows. |
| `CODEX_CLI_PATH` | Auto scan | Codex CLI executable override on Windows. |
| `CODEX_WEB_RUNTIME_DIR` | `.data/runtime` | Runtime directory for command-line Gateway startup. |
| `CODEX_WEB_OFFICIAL_BUNDLE_DIR` | `.data/cache/codex-official-bundle` | Official bundle extraction cache. |
| `CODEX_WEB_OFFICIAL_AUTO_SCAN_UPGRADE` | `1` | Controls automatic official runtime update scanning at startup. |
| `CODEX_WEB_OFFICIAL_USER_DATA_DIR` | `.data/official-user-data` | Isolated official Electron profile directory. |
| `CODEX_WEB_OFFICIAL_TMPDIR` / `CODEX_WEB_OFFICIAL_TMP_DIR` | Auto generated | Hidden-runtime temporary directory used to isolate the official IPC socket. |
| `CODEX_WEB_REPORTS_DIR` | `.data/reports` | Gateway diagnostic-report directory. |
| `CODEX_WEB_WORKSPACE_ROOTS` | Empty | Initial comma-separated workspace roots. |
| `CODEX_HOME` | `~/.codex` | Codex CLI and app-server configuration and runtime data. |

### Advanced Debug Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `CODEX_WEB_PICKED_FILES_MAX_COUNT` | `20` | Maximum number of temporary picked-file request directories. |
| `CODEX_WEB_PICKED_FILE_MAX_BYTES` | `52428800` | Maximum size of one picked file. |
| `CODEX_WEB_PICKED_FILES_MAX_TOTAL_BYTES` | `104857600` | Maximum total size of picked-file temporary directories. |
| `CODEX_WEB_PICKED_FILE_TTL_MS` | `86400000` | Picked-file temporary-directory retention time. |
| `CODEX_WEB_DISABLE_ASSET_CACHE` | Empty | Set to `1` to disable Gateway static-asset caching. |
| `CODEX_WEB_DISABLE_GZIP` | Empty | Set to `1` to disable Gateway gzip responses. |
| `OPENCODEX_DEBUG_WS` | Empty | Set to `1` to enable WebSocket and AppHost diagnostics. |
| `OPENCODEX_WS_LARGE_LOG_BYTES` | `262144` | WebSocket large-message log threshold. |
| `OPENCODEX_WS_SEND_SLOW_MS` | `80` | WebSocket slow-send threshold. |
| `OPENCODEX_WS_STRINGIFY_SLOW_MS` | `20` | WebSocket JSON serialization slow threshold. |
| `OPENCODEX_WS_BUFFERED_LOG_BYTES` | `524288` | WebSocket `bufferedAmount` log threshold. |
| `OPENCODEX_APP_HOST_TRAFFIC_FLUSH_MS` | `2000` | AppHost traffic-statistics flush interval. |
| `OPENCODEX_APP_HOST_LARGE_FRAME_BYTES` | `65536` | AppHost large-frame threshold. |
| `OPENCODEX_WS_DISABLE_DEFLATE` | Empty | Set to `1` to disable WebSocket `permessage-deflate`. |
| `OPENCODEX_WS_DEFLATE_THRESHOLD` | `65536` | WebSocket compression threshold. |
| `OPENCODEX_WS_DEFLATE_CONCURRENCY` | `4` | WebSocket compression concurrency limit. |
| `OPENCODEX_WS_DEFLATE_LEVEL` | `3` | WebSocket zlib compression level. |

## FAQ

### Session history is missing on first open

Mobile Web initially requests the latest five turns. Wait until the connection is stable, then use Retry or refresh the page. There is no need to repeatedly start new Gateway instances. Older history can be loaded page by page from the top.

### Mobile Web remains in the Streaming state

Streaming means the official App Server is still processing the current turn; it does not necessarily mean the page is frozen. Mobile Web continues to receive new items. Use the stop button and confirm if the task must be interrupted.

### The App Server is temporarily unavailable

If the page reports `503, App server restarting, please wait 30s.`, wait for the countdown and do not repeatedly press Send. For emergency recovery, open Settings, enable Debug Mode, and use `Restart App Server` above the App Server logs. Restarting may interrupt an active task.

### State is delayed when the official Desktop app is also open

OpenCodex and the official Desktop app maintain separate view state even though they use the same underlying data. A Web lease controls browser-side write access; it is not the same as an active turn in the official App Server. Another client may therefore still report the session as busy while backend work continues.

### The page does not open after startup

Check the health endpoint first:

```bash
curl http://127.0.0.1:3737/api/health
```

If the port is already in use, select another port:

```bash
PORT=3738 pnpm run web:dev
```

## Plugin System

OpenCodex includes Plugin SDK v2. PC Web can load plugins that use `apiVersion: 2`, an ESM entry point, and a compatible SDK version. Mobile Web does not currently expose a UI plugin host, although it can still share selected Gateway-level capabilities.

- [Plugin development guide](PLUGINS_EN.md)

## Links

[LinuxDo](https://linux.do/)
