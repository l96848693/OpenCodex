# OpenCodex 版本消息

[繁體中文（粵語）](../README.md) | [简体中文](README_CN.md) | [English](README_EN.md)

呢份文件記錄每個版本新增咗乜、修復咗乜。之後有新版本就繼續喺最上面追加，方便一眼睇到最近變化。

----v3.0.0----

1. 增加：以自有源码仓库独立维护 OpenCodex，并将当前移动可靠性版本整理为公开 `v3.0.0`。
2. 增加：重点强化 Windows Gateway、Android Mobile Web 及 Samsung Galaxy S20／S20 Ultra 适配稳定性。
3. 修复：移动 Web 打开项目时不会覆盖项目原有的自定义模型；用户未主动选择模型前会沿用当前会话配置。
4. 说明：本版本暂未测试 macOS、iOS Safari 及其他 Apple 原生浏览器环境。

----v2.1.1----

1. 增加：App Server 自癒流程。斷線或者故障時會進入明確恢復狀態，自動重啟使用單飛控制、最多 3 次，並提供可預期嘅重試時間。
2. 增加：「設定 → 調試模式 → APP Server 日誌」，Gateway 保留最近 200 條脫敏記錄，頁面倒序顯示最新 10 條，並提供 `Restart App Server` 應急按鈕。
3. 增加：App Server 故障或重啟期間禁用建立 session、發送 turn 同附件提交，避免用戶以為操作已經成功。
4. 增加：長 session 分頁讀取。第一次載入最新 5 個 turn，喺頂部繼續向下拉就每次載入較舊 5 個，最多自動展示 50 個。
5. 增加：長 item 提供「載入更多」，唔會直接截斷內容。
6. 增加：Web lease 心跳同 5 分鐘離線釋放。釋放只影響瀏覽器操作權，唔會中斷官方後台正在執行嘅 turn。
7. 增加：手動停止目前任務同接管流程；停止之前會用簡體中文二次確認，取消操作按 `activeTurnId` 冪等處理。
8. 增加：統一錯誤 envelope 同錯誤碼映射，前端可以顯示 `<code> + <message>`、重試時間同 requestId，方便對照文件同日誌排查。
9. 增加：Gateway、Mobile Web 同官方 App Server 之間嘅狀態同步，流式 turn 會持續接收 reasoning、工具調用同最終答覆 item。
10. 修復：第一次載入最近 5 個 turn 時停喺最舊一條，而唔係定位到底部最新內容。
11. 修復：官方應用仍然執行緊嘅 turn 喺 Mobile Web 被誤標成「已停止」。同一個 turn 而家會使用一致狀態。
12. 修復：工具調用 item 有時用普通文字樣式、有時用工具卡片樣式，導致同一個 turn 顯示唔一致。
13. 修復：長 session 載入超時會拖死 App Server，而且 Gateway 無法自癒。
14. 修復：官方 writer 衝突未正確映射成 `409 turn_conflict`，令前端誤判為一般連線錯誤。
15. 修復：歷史 turn 因可變狀態或完成時間被錯誤排序。排序而家優先用 turn 開始時間，只喺缺少時間時先用 UUIDv7／ULID 作穩定 fallback。
16. 修復：WebSocket 重連、Gateway instance 更換同 BFCache 恢復後可能沿用失效 AppHost relay 或 RPC export ID。
17. 修復：Mobile Web 歷史同即時增量合併時，舊 turn 可能竄到最新 turn 後面，重新整理之後仍然保持錯序。
18. 修復：部分 Gateway 啟動日誌會輸出完整本機路徑，改為較安全嘅脫敏記錄。

----v2.1.0----

1. 增加：獨立 Mobile Web 應用，入口係 `/mobile/`，使用 React + TypeScript，唔再依賴官方桌面 Renderer 嘅三欄 DOM 佈局。
2. 增加：版本化 `/api/mobile/*` Gateway 契約、共享 Mobile Contract 同 Mobile Client，將 session、turn、item 狀態收斂成穩定介面。
3. 增加：聊天優先嘅單欄手機介面，同「對話／項目／設定」底部導航；「最近」合併入「項目」。
4. 增加：項目聚合、session 列表、未歸類 session、建立 session、發送 turn、流式回覆同停止任務等首期能力。
5. 增加：Mobile Web 附件上傳同預覽，使用同源 Gateway API 同短期 token，唔直接暴露 `app://fs` 或任意本機路徑。
6. 增加：連線狀態機、斷線 banner、有限重連、5 分鐘 session／隊列超時同 `queue_expired` 錯誤，避免 FIFO 無限等待或增長。
7. 增加：請求 requestId、冪等控制、契約版本協商、`426 client_upgrade_required` 同 Gateway instance 識別。
8. 增加：Samsung Galaxy S20／S20 Ultra 三檔屏幕模式嘅 responsive 基線，支援 `100dvh`、橫豎屏、safe-area、軟鍵盤同 44×44 CSS px 觸控目標。
9. 增加：PC Web Plugin SDK v2、ESM 插件 manifest、內置／外部插件掃描同設定 API；舊式 `index.js` 插件唔再執行。
10. 修復：手機登入後白屏、主內容空殼、窄屏首屏渲染唔穩同 session 內容未載入。
11. 修復：Samsung 瀏覽器左右側欄同時展開、無關閉按鈕、互斥失效同右欄反覆跳動。
12. 修復：Android 底部工具欄遮住輸入框、輸入法上方多出空白、鍵盤關閉後內容被任務欄遮擋。
13. 修復：橫屏或者切換 HD+／FHD+／WQHD+ 後底部導航移出視口、版面唔重新計算。
14. 修復：流式思考內容未即時回顯，令用戶誤以為 Codex 卡住。
15. 修復：項目內 session 無按活動時間排序，以及歷史 session 發送時提示目標不存在。
16. 修復：普通文件附件只喺頁面顯示、實際未交畀 Codex 讀取，同只上傳附件時無法提交。
17. 修復：新版結構化 AppHost 訊息無法中繼、Gateway 重啟後舊頁復用失效 RPC，同官方主 Renderer 被錯誤接管。
18. 修復：非法座標引起未捕獲異常、Statsig 警告／遙測反覆超時、低優先級隊列閒置唔清理。
19. 修復：插件圖片舊協議、過期附件 404、Windows 盤符路徑解析同新版插件圖標第一次請求問題。
20. 修復：未捕獲錯誤日誌缺少 stack 同上下文，令前端問題難以追查。
