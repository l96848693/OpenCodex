## B001

- **標題：** 插件資源舊協議加載失敗
- **發現版本：** v2.0.3
- **優先級：** 中
- **修改時間：** 2026-09-07 00:21
- **描述：** 移動瀏覽器仍請求 app://fs 插件圖標，觸發 ERR_UNKNOWN_URL_SCHEME 及 404 導致圖標缺失。
- **狀態：** 修復
- **開發意見：** 擴大 app://fs 資源節點重寫範圍兼容舊路徑，補齊 `.codex/.tmp/plugins` 固定白名單，其他本機目錄保持拒絕。
- **測試意見：** 2026-09-06 插件頁實測所有本地圖標均走同源 `/api/app-fs`、naturalWidth 大於零，控制台無 404。待真机测试

## B002

- **標題：** 過期附件請求反復 404
- **發現版本：** v2.0.3
- **優先級：** 低
- **修改時間：** 2026-09-07 00:21
- **描述：** 日誌中舊對話引用嘅臨時 clipboard 圖片已唔存在，瀏覽器重複請求 /api/app-fs 後得 404。
- **狀態：** 修復
- **開發意見：** 保持唔存在文件返回 404 嘅安全語義，全局錯誤採集記錄資源 URL 供前端降級處理。
- **測試意見：** 自動化已確認不存在文件維持 404 安全語義；未有可重現嘅失效附件實例驗證占位畫面。待真机测试

## B003

- **標題：** Uncaught 日誌缺少異常詳情
- **發現版本：** v2.0.3
- **優先級：** 中
- **修改時間：** 2026-09-07 00:21
- **描述：** 之前日誌只有 Uncaught 條數無 message、stack、路由同瀏覽器上下文，無法確認根因。
- **狀態：** 修復
- **開發意見：** 增加 window error 與 unhandledrejection 捕獲，上報脫敏後嘅完整異常信息。
- **測試意見：** 2026-09-06 重啟後完整前端走查無 Uncaught；異常 stack 採集需有真實異常先可驗證。待真机测试

## B004

- **標題：** app-fs 網關路由 Windows 盤符路徑解析錯誤導致 404
- **發現版本：** v2.0.3
- **優先級：** 高
- **修改時間：** 2026-09-07 00:21
- **描述：** appFsPathFromRequestPath 對解碼後路徑執行 path.normalize('/' + decoded)，Windows 盤符路徑被強制加前導 / 變成 \C:\...，實際路徑錯誤導致 404。
- **狀態：** 關閉
- **開發意見：** Windows 盤符路徑先按原始絕對路徑規範化，只有相對或根相對路徑才補前導 /，保留原有 allowlist。
- **測試意見：** 用戶已驗收通過；Windows 盤符回歸測試同 API HTTP 200 驗證均通過。待真机测试

## B005

- **標題：** compatibility-report.json 在 Windows 上無法收緊文件權限
- **發現版本：** v2.0.3
- **優先級：** 低
- **修改時間：** 2026-09-07 00:21
- **描述：** gateway/runtime/compatibility/report-store.cjs:97 用 fs.writeFileSync mode:0o600 嘗試限制為僅當前用戶可讀寫，但 Windows NTFS 唔映射 POSIX mode 位，實測為 0o666 非預期 0o600。
- **狀態：** 掛起
- **開發意見：** 待定，Windows 下需改用 ACL/icacls 或改在文檔中聲明該保護僅適用於 POSIX 平台。
- **測試意見：** 無需收緊，因為喺個人使用，後續無暴露安全風險的話先跳過；跨平台測試已改為只喺 POSIX 平台驗證 `0600`。待真机测试

## B006

- **標題：** Gateway 啟動日誌洩露完整路徑
- **發現版本：** v2.1.0
- **優先級：** 低
- **修改時間：** 2026-09-07 15:17
- **描述：** `TC-SEC-007` 發現 runner 啟動日誌直接輸出官方 Electron、runtime cache 及使用者目錄完整路徑；雖然只在本機輸出，仍不符合已評審日誌脫敏要求。
- **狀態：** 修復
- **開發意見：** 在 runner 共用 logging 層統一遮罩 Windows、UNC 及 POSIX 絕對路徑，並對結構化 path 欄位及 URL credential 做脫敏；保留非敏感平台與事件標識。
- **測試意見：** 叻叻豬 2026-09-07：新增 runner logging 回歸測試並通過；3737 重啟實測 runner 輸出無完整使用者／官方路徑或 URL credential，移動入口、health、契約 bootstrap 同錯誤 envelope 冒煙通過，待用戶驗收。

## B007

- **標題：** 跨平台安裝包構建失敗
- **發現版本：** v3.0.0
- **優先級：** 高
- **修改時間：** 2026-09-23 22:41:27
- **描述：** GitHub Actions 發布 3.0.0 時，macOS arm64 及 x64 安裝包構建失敗，electron-builder 清理 Electron macOS 包時找不到 `Versions/Current/Squirrel` 符號鏈接，導致 Draft Release 被跳過；Windows 目前只產出 x64，未有完整架構矩陣。
- **狀態：** 關閉
- **開發意見：** 已升級 electron-builder 至 26.15.3，將 Windows CI 改為 x64、arm64、ia32 矩陣，並移除 `opencodex: link:` 自循環依賴；Release 對外將 ia32 安裝包改名為 x86。GitHub Actions run `35843602359` 已確認 macOS arm64/x64 與 Windows 三架構全部成功。
- **測試意見：** 叻叻豬 2026-09-23：本地 `pnpm test` 463/463 通过；线上 Windows 三架构通过，macOS 两架构未通过，不能标记“通过”，等待 macOS 处理决定及用户验收。
- **開發／測試更新：** 叻叻豬 2026-09-23：移除 package.json／pnpm-lock.yaml 中无实际引用的 `opencodex: link:` 自循环依赖；本地 `pnpm run build` 与 `pnpm test` 均 exit 0。GitHub Actions run `35843602359` 已完整成功，macOS arm64、x64 与 Windows ia32、arm64、x64 产物均生成并通过 Release 产物校验；Colleen 已验收通过并授权关闭。
- **用戶驗收：** Colleen 2026-09-23：Windows 三架构与 macOS 构建已验收通过，允许关闭本 BUG。
