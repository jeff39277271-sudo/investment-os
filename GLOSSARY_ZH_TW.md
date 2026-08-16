# 專有名詞中英對照表

版本：v0.6

用途：統一投資系統、Codex 工程文件、LINE／LIFF UI 與未來手機 App 使用的專有名詞。

## 使用規則

- 文件第一次出現重要英文術語時，使用 `English Term（中文註解）`。
- 程式碼、class、interface、enum、API route、資料表欄位與環境變數不翻譯。
- 中文以台灣工程與投資語境常用詞為優先。
- 若直譯不易理解，中文註解會偏向說明用途。

## 架構與工程

| English term | 中文註解 |
|---|---|
| `Backend` | 後端系統 |
| `Frontend` | 前端介面 |
| `Client` | 使用端／客戶端 |
| `Multi-client architecture` | 多使用端架構 |
| `Backend-first` | 後端優先架構 |
| `Domain Layer` | 領域核心層 |
| `Domain` | 領域核心邏輯 |
| `Application Layer` | 應用服務層 |
| `Application Service` | 應用服務 |
| `Adapter` | 轉接層／介接器 |
| `Provider` | 服務供應介面 |
| `API` | 應用程式介面 |
| `Webhook` | 事件回呼機制 |
| `Repository` | 程式碼專案倉庫 |
| `Monorepo` | 單一程式碼倉庫多模組架構 |
| `CI` | 持續整合 |
| `Schema` | 資料結構定義 |
| `Migration` | 資料庫結構遷移 |
| `Validation` | 資料驗證 |
| `Rate Limiting` | 流量限制 |
| `Idempotency` | 冪等性／避免同一操作被重複執行 |

## LINE／介面

| English term | 中文註解 |
|---|---|
| `Rich Menu` | LINE 圖文選單 |
| `Flex Message` | LINE 彈性訊息卡片 |
| `Postback` | 按鈕回傳事件 |
| `LIFF` | LINE Front-end Framework／LINE 內嵌網頁框架 |
| `Deep Link` | 深層連結／直接開啟指定頁面 |
| `Universal Link` | 通用連結／可直接開啟 App 指定頁面 |
| `Push Notification` | 主動推播通知 |
| `Responsive` | 響應式版面 |
| `Bottom Sheet` | 底部滑出面板 |
| `Floating Inspector` | 浮動資訊檢視面板 |
| `Command Bar` | 自然語言指令輸入列 |
| `Suggestion Chips` | 快捷建議按鈕 |
| `Design Tokens` | 設計變數／視覺規範值 |
| `Semantic Color` | 語意色彩 |
| `Tabular Numerals` | 等寬數字顯示 |
| `Data Freshness` | 資料新鮮度／更新時效 |

## 投資與風險

| English term | 中文註解 |
|---|---|
| `Portfolio` | 投資組合 |
| `Position` | 持倉／部位 |
| `P/L` | 損益 |
| `Realized P/L` | 已實現損益 |
| `Unrealized P/L` | 未實現損益 |
| `NAV` | 淨資產價值／投資組合總值 |
| `Weighted-average cost` | 加權平均成本 |
| `Stop Loss` | 停損 |
| `Take Profit` | 停利 |
| `Portfolio Engine` | 投資組合計算引擎 |
| `Risk Engine` | 風險計算引擎 |
| `Alert Engine` | 警示引擎 |
| `Drawdown` | 回撤 |
| `Volatility` | 波動度 |
| `Correlation` | 相關性 |
| `HHI` | 赫芬達爾－赫希曼集中度指數 |
| `Sector Concentration` | 產業集中度 |
| `Currency Exposure` | 幣別曝險 |
| `Exposure` | 曝險 |

## 市場情報與研究

| English term | 中文註解 |
|---|---|
| `Market Intelligence` | 市場情報 |
| `Market Data` | 市場行情資料 |
| `Market Data Provider` | 市場資料供應介面 |
| `News Provider` | 新聞資料供應介面 |
| `Watchlist` | 觀察名單 |
| `Thesis` | 投資論點 |
| `Thesis Tracker` | 投資論點追蹤器 |
| `Research Workflow` | 研究工作流程 |
| `Company Tearsheet` | 公司一頁式基本面摘要 |
| `Tearsheet` | 公司一頁式摘要 |
| `Research Candidate` | 研究候選標的 |
| `Catalyst` | 催化事件 |
| `Kill Criteria` | 推翻投資論點的條件 |
| `Materiality` | 事件重要性 |
| `Portfolio Relevance` | 與投資組合的關聯程度 |
| `Novelty` | 新穎性／新增資訊程度 |
| `Source Quality` | 來源品質 |
| `Digest` | 濃縮摘要 |
| `Daily Digest` | 每日濃縮摘要 |
| `Quiet Hours` | 靜音時段 |
| `Comps` | 可比公司估值 |
| `Comparable Companies` | 可比公司 |
| `DCF` | 現金流折現估值 |
| `EV` | 企業價值 |
| `Equity Value` | 股權價值 |
| `EV-to-Equity Bridge` | 企業價值轉股權價值橋接 |
| `Capital Structure` | 資本結構 |

## AI 與自然語言

| English term | 中文註解 |
|---|---|
| `AI Gateway` | AI 統一介接層 |
| `LLM` | 大型語言模型 |
| `LLMProvider` | 大型語言模型供應介面 |
| `Local LLM` | 本地大型語言模型 |
| `LocalLLMProvider` | 本地模型供應介面 |
| `CloudLLMProvider` | 雲端模型供應介面 |
| `MockLLMProvider` | 測試用模擬模型介面 |
| `Deterministic parser` | 確定性規則解析器 |
| `Deterministic Command Parser` | 確定性指令解析器 |
| `Deterministic` | 確定性／依固定規則運作 |
| `Intent` | 使用者意圖 |
| `Intent Router` | 意圖路由器 |
| `Command Router` | 指令路由器 |
| `Slot Extraction` | 欄位／參數擷取 |
| `Structured Output` | 結構化輸出 |
| `Context` | 對話上下文 |
| `Conversational State` | 對話狀態 |
| `Session` | 工作階段 |
| `Function Calling` | 函式呼叫 |
| `Tool Calling` | 工具呼叫 |
| `Tool Registry` | 工具註冊表 |
| `Prompt` | 提示詞 |

## 資料與背景工作

| English term | 中文註解 |
|---|---|
| `WebSocket` | 即時雙向連線 |
| `REST` | REST API／網路資料介面 |
| `Worker` | 背景工作程序 |
| `Scheduler` | 排程器 |
| `Job` | 背景工作任務 |
| `Queue` | 工作佇列 |
| `Event` | 事件 |
| `Event Cluster` | 事件群組／同一新聞事件聚類 |
| `Deduplication` | 去重／避免重複事件 |
| `Cooldown` | 冷卻時間 |
| `Crossing` | 價格穿越條件 |
| `Draft` | 待確認草稿 |
| `Confirmation` | 確認執行 |
| `Mutation` | 資料異動操作 |
| `Read-only` | 唯讀 |
| `Command` | 操作指令 |
| `Query` | 查詢指令 |
| `As-of` | 資料截至時間 |
| `Stale Data` | 過期資料 |

## 身分、安全與測試

| English term | 中文註解 |
|---|---|
| `Authentication` | 身分驗證 |
| `Authorization` | 權限驗證 |
| `Identity Provider` | 身分驗證供應介面 |
| `User Identity` | 使用者身分 |
| `Ownership Check` | 資料所有權檢查 |
| `JWT` | JSON Web Token／登入權杖 |
| `Secure Cookie` | 安全 Cookie |
| `Biometrics` | 生物辨識驗證 |
| `E2E` | 端到端測試 |
| `Unit Test` | 單元測試 |
| `Integration Test` | 整合測試 |
| `Regression Test` | 回歸測試 |
| `Screenshot-based QA` | 截圖式介面品質檢查 |
