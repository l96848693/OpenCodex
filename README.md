# OpenCodex

**公开版本：v3.0.0** · [源码仓库](https://github.com/l96848693/OpenCodex) · [AGPL-3.0 许可证](LICENSE)

**繁體中文（粵語）** | [简体中文](docs/README_CN.md) | [English](docs/README_EN.md) | [版本消息](docs/NEWS.md)

OpenCodex 係一層連接 Codex 桌面運行時同瀏覽器嘅中間層，兼容舊版 Codex Desktop 同新版 ChatGPT Desktop。你可以用手機、平板或者另一部電腦，透過瀏覽器操作目標電腦上嘅 Codex，唔使長期坐喺電腦前面都可以繼續 AI Coding。

---

ChatGPT App 對大陸 Android 生態唔友好，所以我決定企喺巨人膊頭上，繼續搞好呢個 project。

同官方方案相比，OpenCodex 仲有幾個幾實用嘅場景：

1. 原作者版本嚮我部 Samsung 上體驗唔好，所以整咗個獨立 Mobile Web 頁面，唔再將桌面三欄畫面塞入手機。
2. 唔需要外區 Google Play／Apple 帳號，亦支援用第三方 API 登入後遠端使用。
3. PC Web 保留 Codex 原有體驗，包括檔案樹、終端同審查等能力。
4. 可以自由配合 Tailscale、ZeroTier、VPN 或內網穿透，唔經官方中繼，速度同私隱都更容易由自己控制。

---

## 功能特色

- 用瀏覽器操作目標電腦上嘅 Codex，支援手機、平板同電腦。
- PC Web 保留原汁原味嘅 Codex 使用體驗。
- 提供獨立 `/mobile/` 頁面，針對窄屏、觸控、軟鍵盤同橫豎屏重新設計。
- 支援本機、局域網，同配合 Tailscale／ZeroTier／VPN 嘅遠端局域網存取。
- 支援存取密碼，避免未經認證直接打開服務。
- 提供桌面啟動器，可以設定監聽地址、端口同密碼。
- 移動版支援項目同 session 瀏覽、turn 分頁、流式 item、停止任務、附件同連線狀態。
- Gateway 同官方 Electron runtime 保持隔離，唔會修改官方安裝目錄。
- 內置 Plugin SDK v2；PC Web 可以載入內置或外部 ESM 插件。
- 實際測試範圍主要係 Windows Gateway、Android Mobile Web，以及 Samsung Galaxy S20／S20 Ultra；本版本亦針對呢幾類環境強化穩定性。
- macOS、Safari（包括 iOS Safari）同其他 Apple 原生瀏覽器目前未有測試，因此唔保證兼容性。

## 環境要求

- Node.js
- pnpm
- 本機已安裝舊版 Codex Desktop，或者包含 Codex 嘅新版 ChatGPT Desktop；唔需要預先啟動，亦可以同 OpenCodex 一齊使用。
- Windows／macOS／Linux；Linux 暫時需要用命令行啟動。

## 點樣使用

### 桌面啟動器

由 Release 頁面下載安裝包，或者喺本地執行：

```bash
pnpm install
pnpm run launcher:dev
```

建立安裝包：

```bash
pnpm run launcher:dist:mac
pnpm run launcher:dist:win
```

輸出會放喺 `release/`。第一次啟動會揀一個可用端口；修改監聽地址、端口或者存取密碼之後，Launcher 會重啟 Gateway 令設定生效。

### 命令行啟動

Bash／macOS／Linux：

```bash
pnpm install
HOST=127.0.0.1 PORT=3737 pnpm run web:dev
```

Windows PowerShell 唔可以直接照抄上面嘅 Bash 環境變數寫法，要用：

```powershell
pnpm install
$env:HOST = "127.0.0.1"
$env:PORT = "3737"
pnpm run web:dev
```

如果要俾手機經局域網或者 Tailscale 存取：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "39289"
pnpm run web:dev
```

第一次執行會先編譯，再準備官方 Electron runtime。見到 `Gateway listening` 先代表服務真係可以用；只見到 `esbuild`、下載進度或者 `retrying`，都未算啟動完成。

可以用 PowerShell 檢查端口同健康狀態：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3737 -ErrorAction SilentlyContinue
Invoke-RestMethod http://127.0.0.1:3737/api/health | Select-Object ok,gateway
```

啟動後打開：

```text
PC Web：http://127.0.0.1:3737/
Mobile Web：http://127.0.0.1:3737/mobile/
```

### 設定存取密碼

強烈建議設定密碼，遠端使用時亦建議改端口。先複製設定檔：

```bash
cp config.example.yaml config.yaml
```

```yaml
auth:
  password: "你嘅密碼"
```

### 停止調試服務

`pnpm run web:dev` 會喺目前終端前台運行。要關閉就返去嗰個終端按 `Ctrl+C`，唔需要另外執行停止命令。

同一部電腦建議一次只開一個 OpenCodex Gateway。3737 開發環境同 39289 測試環境就算端口唔同，仍然可能共用官方 Electron runner 快取；第二個 Gateway 會報 `ERR_OPENCODEX_RUNTIME_IN_USE`。要換環境，先正常停止原本嘅 Gateway，唔好結束官方 Codex 進程，更加唔好直接刪 runtime 快取。

如果原本嘅終端已經關閉，可以先精確搵出本項目嘅 dev runner，再決定係咪停止：

```powershell
$runner = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*OpenCodex*gateway\dev\run-gateway.cjs*"
}
$runner | Select-Object ProcessId,CommandLine
$runner | ForEach-Object { Stop-Process -Id $_.ProcessId }
```

### Linux 使用

Linux 暫時未提供預先打包嘅 Launcher，建議跟住 [Linux 設定指南](docs/LINUX_GUIDE.md) 用命令行啟動。

### 遠端存取

OpenCodex 本身唔提供遠端網絡服務。如果要喺其他裝置存取，可以用 Tailscale、ZeroTier、Cloudflare Tunnel 或公司自建 VPN，再喺 Launcher 開啟局域網模式。

可以直接暴露到公網，但唔建議咁做。用受控網絡同存取密碼會安全得多。

## Mobile Web 行為

- 第一次打開 session 會載入最新 5 個 turn，由舊到新排列，並定位到最底部最新內容。
- 喺歷史頂部繼續向下拉，可以每次再載入 5 個較舊 turn，最多自動展示 50 個。
- 特別長嘅 item 唔會直接截斷；頁面會提供「載入更多」。
- 官方桌面仍在執行嘅 turn，Mobile Web 會顯示「流式中」並繼續接收最新 item。
- 流式期間發送按鈕會變成停止按鈕；停止目前任務之前會再確認，避免誤觸。
- Web 連續離線 5 分鐘會釋放 Web lease，但唔會中斷官方後台正在做嘅 turn。重新連線後，如果冇其他瀏覽器接管，就可以重新取得操作權。

## 常用環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 命令行 Gateway 監聽地址。 |
| `PORT` | `3737` | 命令行 Gateway 監聽端口。 |
| `OPENCODEX_HOST` | `127.0.0.1` | Launcher 第一次啟動 Gateway 嘅預設監聽地址。 |
| `OPENCODEX_PORT` | 隨機可用端口 | Launcher 第一次啟動 Gateway 嘅預設端口。 |
| `OPENCODEX_PREFERRED_LANGUAGES` | `zh-CN` | OpenCodex 自有介面語言，可以用 JSON 陣列或逗號分隔。 |
| `OPENCODEX_PLUGIN_DIRS` | 空 | 外部插件根目錄；多個目錄可以用系統路徑分隔符或者 JSON 陣列。 |
| `OPENCODEX_LOG_MAX_MB` | `10` | `gateway.log` 單檔大小上限；最多另外保留一個 `gateway.log.old`。 |
| `CODEX_WEB_CONFIG_PATH` | `config.yaml` | Gateway 認證設定檔路徑。 |
| `CODEX_WEB_AUTH_TOKEN_TTL_MS` | `43200000` | Gateway 存取 token 有效期，預設 12 小時。 |
| `CODEX_WEB_DEBUG` | 空 | 設成 `1` 或 `true` 會輸出更多調試日誌。 |
| `CODEX_WEB_SLOW_LOG_MS` | `750` | IPC 慢調用日誌門檻，單位毫秒。 |
| `CODEX_WEB_LOCAL_FILE_TOKEN_TTL_MS` | `300000` | 本機檔案預覽 URL token 有效期。 |
| `CODEX_DESKTOP_APP_PATH` | 自動掃描 | Codex／ChatGPT Desktop 安裝路徑，或者 `app.asar` 所在路徑。 |
| `CODEX_DESKTOP_EXECUTABLE_PATH` | 自動掃描 | Windows／Linux 官方 Electron 可執行檔路徑。 |
| `CODEX_APP_SERVER_BINARY_PATH` | 自動掃描 | Windows Codex app-server／CLI 路徑。 |
| `CODEX_CLI_PATH` | 自動掃描 | Windows Codex CLI 路徑。 |
| `CODEX_WEB_RUNTIME_DIR` | `.data/runtime` | 命令行 Gateway 運行目錄。 |
| `CODEX_WEB_OFFICIAL_BUNDLE_DIR` | `.data/cache/codex-official-bundle` | 官方 bundle 解包快取目錄。 |
| `CODEX_WEB_OFFICIAL_AUTO_SCAN_UPGRADE` | `1` | 控制啟動時係咪自動掃描官方 runtime 更新。 |
| `CODEX_WEB_OFFICIAL_USER_DATA_DIR` | `.data/official-user-data` | 隔離嘅官方 Electron profile 目錄。 |
| `CODEX_WEB_OFFICIAL_TMPDIR` / `CODEX_WEB_OFFICIAL_TMP_DIR` | 自動產生 | Hidden runtime 臨時目錄，用嚟隔離官方 IPC socket。 |
| `CODEX_WEB_REPORTS_DIR` | `.data/reports` | Gateway 診斷報告輸出目錄。 |
| `CODEX_WEB_WORKSPACE_ROOTS` | 空 | 初始 workspace roots，用逗號分隔。 |
| `CODEX_HOME` | `~/.codex` | Codex CLI／app-server 設定同運行資料目錄。 |

### 進階調試環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `CODEX_WEB_PICKED_FILES_MAX_COUNT` | `20` | Web 臨時 picked-file 請求目錄上限。 |
| `CODEX_WEB_PICKED_FILE_MAX_BYTES` | `52428800` | 單個 picked file 大小上限。 |
| `CODEX_WEB_PICKED_FILES_MAX_TOTAL_BYTES` | `104857600` | picked-file 臨時目錄總大小上限。 |
| `CODEX_WEB_PICKED_FILE_TTL_MS` | `86400000` | picked-file 臨時目錄保留時間。 |
| `CODEX_WEB_DISABLE_ASSET_CACHE` | 空 | 設成 `1` 會停用 Gateway 靜態資源快取。 |
| `CODEX_WEB_DISABLE_GZIP` | 空 | 設成 `1` 會停用 Gateway gzip。 |
| `OPENCODEX_DEBUG_WS` | 空 | 設成 `1` 會開啟 WebSocket／AppHost 診斷。 |
| `OPENCODEX_WS_LARGE_LOG_BYTES` | `262144` | WebSocket 大訊息日誌門檻。 |
| `OPENCODEX_WS_SEND_SLOW_MS` | `80` | WebSocket 慢發送日誌門檻。 |
| `OPENCODEX_WS_STRINGIFY_SLOW_MS` | `20` | WebSocket JSON 序列化慢日誌門檻。 |
| `OPENCODEX_WS_BUFFERED_LOG_BYTES` | `524288` | WebSocket `bufferedAmount` 日誌門檻。 |
| `OPENCODEX_APP_HOST_TRAFFIC_FLUSH_MS` | `2000` | AppHost 流量統計 flush 間隔。 |
| `OPENCODEX_APP_HOST_LARGE_FRAME_BYTES` | `65536` | AppHost 大 frame 日誌門檻。 |
| `OPENCODEX_WS_DISABLE_DEFLATE` | 空 | 設成 `1` 會關閉 WebSocket `permessage-deflate`。 |
| `OPENCODEX_WS_DEFLATE_THRESHOLD` | `65536` | WebSocket 壓縮門檻。 |
| `OPENCODEX_WS_DEFLATE_CONCURRENCY` | `4` | WebSocket 壓縮並發上限。 |
| `OPENCODEX_WS_DEFLATE_LEVEL` | `3` | WebSocket zlib 壓縮等級。 |

## 常見問題

### 第一次打開 session 睇唔到歷史

Mobile Web 會先讀取最新 5 個 turn。等連線狀態穩定之後，可以按「再試一次」或者重新整理；唔需要不停開新 Gateway。長 session 之後可以喺歷史頂部逐頁載入。

### Mobile Web 一直顯示「流式中」

「流式中」代表官方 App Server 仲處理緊目前 turn，唔係頁面卡死。Mobile Web 會繼續收取新 item；如果要中斷，可以按停止按鈕並確認。

### App Server 暫時斷開

如果見到 `503, App server restarting, please wait 30s.`，先等倒數完，唔好連續撳發送。需要應急處理時，可以去「設定」開啟「調試模式」，喺「APP Server 日誌」頂部按 `Restart App Server`。重啟可能會中斷正在執行嘅任務。

### 同官方 Desktop 同時使用時同步唔及時

OpenCodex 同官方 Desktop 會各自維護頁面狀態，資料來源相同，但畫面未必每一刻都同步。Web lease 只控制瀏覽器端操作權，唔等於官方 App Server 嘅活動 turn；後台仲做緊嘢時，另一端仍然可能顯示 session 忙碌。

### 啟動後打唔開頁面

先檢查健康狀態：

```bash
curl http://127.0.0.1:3737/api/health
```

如果端口已經俾其他程式用咗，可以換一個：

```bash
PORT=3738 pnpm run web:dev
```

## 插件系統

OpenCodex 內置 Plugin SDK v2。PC Web 可以用插件擴充 Codex 功能，外部插件需要使用 `apiVersion: 2`、ESM 入口同兼容嘅 SDK 版本。Mobile Web 暫時未提供 UI 插件宿主，但仍然可以共用部分 Gateway 層能力。

- [插件開發文件](docs/PLUGINS.md)

## 友鏈

[LinuxDo](https://linux.do/)
