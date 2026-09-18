# 項目開發規範 (Project Guidelines)

本文件定義咗本項目嘅代碼開發、版本控制同 AI 交互規範。所有開發者（包括 AI Agents）必須嚴格遵守。

## 1. 語言與溝通規範 (Language Policy)
遵循同级目录`COMMON.md`

## 3. 項目結構與工具 (Project Structure & Tools)
遵循同级目录`COMMON.md`

## 4. 測試規範 (Testing)
遵循同级目录`COMMON.md`

## 5. 瀏覽器自動化與 MCP (Browser & MCP)
*基於 AGENTS.md 強制約束*

- **Edge 瀏覽器路由**：
  - 瀏覽、測試或調試網頁時，**必須**先讀取並遵循 `$edge-browser-router` Skill。
  - **嚴禁**繞過 Skill 直接將 `edge-browser-mcp` 當作默認入口。
  - MCP 僅作為 Skill 按需啟動嘅 `profile` 或 `extension` 後端。
- **執行流程**：
  - 用戶未指定軌道時，依次嘗試：官方 Edge 集成 -> 專用 Profile -> Playwright Extension。
  - 任務結束後，**必須**清理本次自動化資源。

## 6. 開發規範
遵循同级目录`COMMON.md`

## 7. BUG模版
遵循同级目录`COMMON.md`

## 8.研發文檔
遵循同级目录`COMMON.md`

