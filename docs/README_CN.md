# OpenCodex

**公开版本：v3.0.0** · [源码仓库](https://github.com/l96848693/OpenCodex) · [AGPL-3.0 许可证](../LICENSE)

[繁體中文（粵語）](../README.md) | **简体中文** | [English](README_EN.md) | [版本消息](NEWS.md)

版本消息：请查看 [NEWS.md](NEWS.md)，每个版本的新增、修复和发布说明都会按版本号追加。

OpenCodex 是一层连接 Codex 桌面运行时与浏览器的中间层，兼容旧版 Codex Desktop 和新版 ChatGPT Desktop。你可以使用手机、平板或另一台电脑，通过浏览器操作目标电脑上的 Codex，不必一直坐在电脑前也能继续 AI Coding。

---

ChatGPT App 对中国大陆 Android 生态不算友好，因此我决定站在巨人的肩膀上，继续完善这个项目。

与官方方案相比，OpenCodex 仍有一些实用场景：

1. 原作者版本在 Samsung 手机上体验不够理想，因此现在提供独立的 Mobile Web 页面，不再把桌面三栏布局勉强塞进手机。
2. 不需要外区 Google Play／Apple 账号，也支持使用第三方 API 登录后远程访问。
3. PC Web 保留 Codex 原有体验，包括文件树、终端和审查等能力。
4. 可以自由配合 Tailscale、ZeroTier、VPN 或内网穿透，不经过官方中继，速度与隐私更容易由自己控制。

---

## 功能特色

- 通过浏览器操作目标电脑上的 Codex，支持手机、平板和电脑。
- PC Web 保留原汁原味的 Codex 使用体验。
- 提供独立 `/mobile/` 页面，针对窄屏、触控、软键盘和横竖屏重新设计。
- 支持本机、局域网，以及配合 Tailscale／ZeroTier／VPN 的远程局域网访问。
- 支持访问密码，避免未经认证直接打开服务。
- 提供桌面启动器，可以设置监听地址、端口和密码。
- 移动版支持项目与会话浏览、轮次分页、流式事件、停止任务、附件和连接状态。
- Gateway 与官方 Electron runtime 保持隔离，不修改官方安装目录。
- 内置 Plugin SDK v2；PC Web 可以加载内置或外部 ESM 插件。
- 实际测试范围主要是 Windows Gateway、Android Mobile Web，以及 Samsung Galaxy S20／S20 Ultra；本版本也针对这些环境强化了稳定性。
- macOS、Safari（包括 iOS Safari）及其他 Apple 原生浏览器目前未测试，因此不保证兼容性。

## 项目来源与发布说明

- 本仓库由 Colleen 独立维护，源码、许可证和版本消息入口位于页面顶部；项目基于 [RyensX/OpenCodex](https://github.com/RyensX/OpenCodex) 演进，感谢原作者及上游贡献者。
- GitHub Actions 会按改动范围处理：只修改根目录 `README.md` 或 `docs/` 文档时仍会保留检查，但跳过 Windows／macOS 安装包构建；源码改动和版本发布提交仍会执行完整构建。
- Windows Release 会按 `win-x64`、`win-arm64`、`win-x86` 分别产出安装包；macOS 会按 `mac-x64`、`mac-arm64` 产出 DMG。x64 是主要实测目标，其他架构以 CI 构建结果和目标设备验证为准。
- 启动器会优先打开已安装的 OpenCodex PWA，找不到时才回退到普通浏览器；官方 runtime 更新前会保留上一版本备份，必要时可在启动器中还原。

## 环境要求

- Node.js
- pnpm
- 本机已安装旧版 Codex Desktop，或包含 Codex 的新版 ChatGPT Desktop；无需预先启动，也可以与 OpenCodex 同时使用。
- Windows／macOS／Linux；Linux 暂时需要使用命令行启动。

## 如何使用

### 桌面启动器

从 Release 页面下载安装包，或者在本地执行：

```bash
pnpm install
pnpm run launcher:dev
```

生成安装包：

```bash
pnpm run launcher:dist:mac
pnpm run launcher:dist:win
```

产物会输出到 `release/`。首次启动会选择一个可用端口；修改监听地址、端口或访问密码后，Launcher 会重启 Gateway 使设置生效。

### 命令行启动

Bash／macOS／Linux：

```bash
pnpm install
HOST=127.0.0.1 PORT=3737 pnpm run web:dev
```

Windows PowerShell 不能直接复制上面的 Bash 环境变量写法，请使用：

```powershell
pnpm install
$env:HOST = "127.0.0.1"
$env:PORT = "3737"
pnpm run web:dev
```

如果需要让手机通过局域网或 Tailscale 访问：

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "39289"
pnpm run web:dev
```

首次运行会先编译并准备官方 Electron runtime。看到 `Gateway listening` 才表示服务真正可用；只有 `esbuild`、下载进度或 `retrying` 时，都还没有启动完成。

可以使用 PowerShell 检查端口和健康状态：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3737 -ErrorAction SilentlyContinue
Invoke-RestMethod http://127.0.0.1:3737/api/health | Select-Object ok,gateway
```

启动后访问：

```text
PC Web：http://127.0.0.1:3737/
Mobile Web：http://127.0.0.1:3737/mobile/
```

### 设置访问密码

强烈建议设置密码，远程使用时也建议修改端口。先复制配置文件：

```bash
cp config.example.yaml config.yaml
```

```yaml
auth:
  password: "你的密码"
```

### 停止调试服务

`pnpm run web:dev` 会在当前终端前台运行。需要关闭时，返回该终端按 `Ctrl+C`，不需要另外执行停止命令。

同一台电脑建议一次只运行一个 OpenCodex Gateway。3737 开发环境与 39289 测试环境即使端口不同，仍可能共用官方 Electron runner 缓存；第二个 Gateway 会报告 `ERR_OPENCODEX_RUNTIME_IN_USE`。切换环境前请正常停止原 Gateway，不要结束官方 Codex 进程，也不要直接删除 runtime 缓存。

如果原终端已经关闭，可以先精确查找本项目的 dev runner，再决定是否停止：

```powershell
$runner = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*OpenCodex*gateway\dev\run-gateway.cjs*"
}
$runner | Select-Object ProcessId,CommandLine
$runner | ForEach-Object { Stop-Process -Id $_.ProcessId }
```

### Linux 使用

Linux 暂时没有预打包 Launcher，建议按照 [Linux 配置指南](LINUX_GUIDE.md) 使用命令行启动。

### 远程访问

OpenCodex 本身不提供远程网络服务。如果需要从其他设备访问，可以使用 Tailscale、ZeroTier、Cloudflare Tunnel 或企业自建 VPN，再在 Launcher 中启用局域网模式。

可以直接暴露到公网，但不建议这样使用。受控网络与访问密码更加安全。

## Mobile Web 行为

- 首次打开会话会加载最新 5 个轮次，由旧到新排列，并定位到最底部的最新内容。
- 在历史顶部继续向下拉，每次可以再加载 5 个更早轮次，最多自动展示 50 个。
- 特别长的事件不会被直接截断；页面会提供“加载更多”。
- 官方桌面仍在执行的轮次，Mobile Web 会显示“流式中”并继续接收最新事件。
- 流式期间发送按钮会变成停止按钮；停止当前任务前需要再次确认，避免误触。
- Web 连续离线 5 分钟会释放 Web lease，但不会中断官方后台正在执行的轮次。重新连接后，如果没有其他浏览器接管，就可以重新取得操作权。

## 常用环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 命令行 Gateway 监听地址。 |
| `PORT` | `3737` | 命令行 Gateway 监听端口。 |
| `OPENCODEX_HOST` | `127.0.0.1` | Launcher 首次启动 Gateway 时使用的默认监听地址。 |
| `OPENCODEX_PORT` | 随机可用端口 | Launcher 首次启动 Gateway 时使用的默认端口。 |
| `OPENCODEX_PREFERRED_LANGUAGES` | `zh-CN` | OpenCodex 自有界面语言，可使用 JSON 数组或逗号分隔。 |
| `OPENCODEX_PLUGIN_DIRS` | 空 | 外部插件根目录；多个目录可使用系统路径分隔符或 JSON 数组。 |
| `OPENCODEX_LOG_MAX_MB` | `10` | `gateway.log` 单文件大小上限；最多额外保留一个 `gateway.log.old`。 |
| `CODEX_WEB_CONFIG_PATH` | `config.yaml` | Gateway 认证配置文件路径。 |
| `CODEX_WEB_AUTH_TOKEN_TTL_MS` | `43200000` | Gateway 访问 token 有效期，默认 12 小时。 |
| `CODEX_WEB_DEBUG` | 空 | 设置为 `1` 或 `true` 后输出更多调试日志。 |
| `CODEX_WEB_SLOW_LOG_MS` | `750` | IPC 慢调用日志阈值，单位毫秒。 |
| `CODEX_WEB_LOCAL_FILE_TOKEN_TTL_MS` | `300000` | 本地文件预览 URL token 有效期。 |
| `CODEX_DESKTOP_APP_PATH` | 自动扫描 | Codex／ChatGPT Desktop 安装路径或 `app.asar` 所在路径。 |
| `CODEX_DESKTOP_EXECUTABLE_PATH` | 自动扫描 | Windows／Linux 官方 Electron 可执行文件路径。 |
| `CODEX_APP_SERVER_BINARY_PATH` | 自动扫描 | Windows Codex app-server／CLI 路径。 |
| `CODEX_CLI_PATH` | 自动扫描 | Windows Codex CLI 路径。 |
| `CODEX_WEB_RUNTIME_DIR` | `.data/runtime` | 命令行 Gateway 运行目录。 |
| `CODEX_WEB_OFFICIAL_BUNDLE_DIR` | `.data/cache/codex-official-bundle` | 官方 bundle 解包缓存目录。 |
| `CODEX_WEB_OFFICIAL_AUTO_SCAN_UPGRADE` | `1` | 控制启动时是否自动扫描官方 runtime 更新。 |
| `CODEX_WEB_OFFICIAL_USER_DATA_DIR` | `.data/official-user-data` | 隔离的官方 Electron profile 目录。 |
| `CODEX_WEB_OFFICIAL_TMPDIR` / `CODEX_WEB_OFFICIAL_TMP_DIR` | 自动生成 | Hidden runtime 临时目录，用于隔离官方 IPC socket。 |
| `CODEX_WEB_REPORTS_DIR` | `.data/reports` | Gateway 诊断报告输出目录。 |
| `CODEX_WEB_WORKSPACE_ROOTS` | 空 | 初始 workspace roots，使用逗号分隔。 |
| `CODEX_HOME` | `~/.codex` | Codex CLI／app-server 配置与运行数据目录。 |

### 高级调试环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_WEB_PICKED_FILES_MAX_COUNT` | `20` | Web 临时 picked-file 请求目录上限。 |
| `CODEX_WEB_PICKED_FILE_MAX_BYTES` | `52428800` | 单个 picked file 大小上限。 |
| `CODEX_WEB_PICKED_FILES_MAX_TOTAL_BYTES` | `104857600` | picked-file 临时目录总大小上限。 |
| `CODEX_WEB_PICKED_FILE_TTL_MS` | `86400000` | picked-file 临时目录保留时间。 |
| `CODEX_WEB_DISABLE_ASSET_CACHE` | 空 | 设置为 `1` 后禁用 Gateway 静态资源缓存。 |
| `CODEX_WEB_DISABLE_GZIP` | 空 | 设置为 `1` 后禁用 Gateway gzip。 |
| `OPENCODEX_DEBUG_WS` | 空 | 设置为 `1` 后启用 WebSocket／AppHost 诊断。 |
| `OPENCODEX_WS_LARGE_LOG_BYTES` | `262144` | WebSocket 大消息日志阈值。 |
| `OPENCODEX_WS_SEND_SLOW_MS` | `80` | WebSocket 慢发送日志阈值。 |
| `OPENCODEX_WS_STRINGIFY_SLOW_MS` | `20` | WebSocket JSON 序列化慢日志阈值。 |
| `OPENCODEX_WS_BUFFERED_LOG_BYTES` | `524288` | WebSocket `bufferedAmount` 日志阈值。 |
| `OPENCODEX_APP_HOST_TRAFFIC_FLUSH_MS` | `2000` | AppHost 流量统计 flush 间隔。 |
| `OPENCODEX_APP_HOST_LARGE_FRAME_BYTES` | `65536` | AppHost 大 frame 日志阈值。 |
| `OPENCODEX_WS_DISABLE_DEFLATE` | 空 | 设置为 `1` 后关闭 WebSocket `permessage-deflate`。 |
| `OPENCODEX_WS_DEFLATE_THRESHOLD` | `65536` | WebSocket 压缩阈值。 |
| `OPENCODEX_WS_DEFLATE_CONCURRENCY` | `4` | WebSocket 压缩并发上限。 |
| `OPENCODEX_WS_DEFLATE_LEVEL` | `3` | WebSocket zlib 压缩等级。 |

## 常见问题

### 首次打开会话看不到历史

Mobile Web 会先读取最新 5 个轮次。等待连接状态稳定后，可以点击“再试一次”或刷新页面；不需要反复启动新 Gateway。长会话之后可以在历史顶部逐页加载。

### Mobile Web 一直显示“流式中”

“流式中”表示官方 App Server 仍在处理当前轮次，并不代表页面卡死。Mobile Web 会继续接收新事件；如果需要中断，可以点击停止按钮并确认。

### App Server 暂时断开

如果看到 `503, App server restarting, please wait 30s.`，请先等待倒计时结束，不要连续点击发送。需要应急处理时，可以进入“设置”打开“调试模式”，在“APP Server 日志”顶部点击 `Restart App Server`。重启可能中断正在执行的任务。

### 与官方 Desktop 同时使用时同步不及时

OpenCodex 与官方 Desktop 会分别维护页面状态，虽然数据来源相同，但界面不一定始终实时同步。Web lease 只控制浏览器端操作权，不等于官方 App Server 的活动轮次；后台仍在执行时，另一端仍可能显示会话忙碌。

### 启动后无法打开页面

先检查健康状态：

```bash
curl http://127.0.0.1:3737/api/health
```

如果端口已被占用，可以更换端口：

```bash
PORT=3738 pnpm run web:dev
```

## 插件系统

OpenCodex 内置 Plugin SDK v2。PC Web 可以使用插件扩展 Codex 功能，外部插件需要使用 `apiVersion: 2`、ESM 入口和兼容的 SDK 版本。Mobile Web 暂时没有 UI 插件宿主，但仍可共用部分 Gateway 层能力。

- [插件开发文档](PLUGINS.md)

## 友情链接

[LinuxDo](https://linux.do/)
