# Investment OS

Investment OS 是以 LINE + LIFF 為 V1 入口的個人投資紀錄與研究系統。此 repository 目前完成 Phase 0、Phase 1、Phase 1.5 與 Phase 2：TypeScript Monorepo（單一程式碼倉庫多模組架構）、PostgreSQL schema/migration、以 `transactions` 為唯一 source of truth（資產真相來源）的交易核心，以及 LINE Messaging API（LINE 訊息 API）adapter。

## 本機執行

需求：Node.js 22、pnpm 9、Docker Desktop（用於 PostgreSQL integration test）。

```bash
pnpm install
Copy-Item .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

若要執行 PostgreSQL Integration Test（資料庫整合測試），請在 PowerShell 使用：

```powershell
$env:RUN_POSTGRES_INTEGRATION='true'
pnpm test
```

這組測試會實際建立 user、portfolio、instrument、draft 與 transaction，驗證 ownership、expiry、confirmation Idempotency（冪等性／避免同一操作被重複執行）、void／reversal 與 portfolio summary。未設定 `RUN_POSTGRES_INTEGRATION` 時，`pnpm test` 只執行不需外部服務的 domain tests；CI 或本機具備 PostgreSQL 時應設定它以執行完整測試。

`.env.example` 僅包含本機開發用的非 secret 設定名稱；請複製成 `.env` 後再依環境調整，禁止提交真實 token 或 API key。

## Phase 2 LINE Integration（LINE 整合）

`POST /webhooks/line` 使用未解析的 raw body 與 `X-Line-Signature` 驗證 webhook。LINE `userId` 只用來查找 `user_identities`；application workflow 一律使用 internal `user_id`。首次使用者會以同一個 PostgreSQL transaction 建立 internal user、LINE identity 與主要投資組合。

Phase 2 parser 僅接受 `BUY 2330 100 1250`、`SELL 2330 50 1300` 及同格式的「買／賣」指令。指令只建立 server-side draft，Flex Message（彈性訊息）按鈕以 server-side `draftId` postback，確認與取消仍呼叫既有 application service。`line_webhook_events` 提供持久化 Idempotency（冪等性／避免同一操作被重複執行）；重送事件不會再建立 draft 或 transaction，失敗與逾時中的事件可安全重試。

正式環境需要設定 `LINE_CHANNEL_SECRET` 與 `LINE_CHANNEL_ACCESS_TOKEN`；`.env.example` 只保留空白欄位，不含 secrets。Phase 2 不包含 LLM、行情、警示、新聞、LIFF 或研究功能。

## Phase 0 + Phase 1 架構

目前只提供 Backend（後端系統）的 monorepo 基礎、PostgreSQL schema／Migration（資料庫結構遷移）、Transaction Ledger（交易流水帳／交易唯一事實來源）與確定性的 Portfolio Engine（投資組合計算引擎）。Domain Layer（領域核心層）不依賴任何 client、LINE、LIFF、AI 或市場行情 provider。

Phase 1.5 新增 `packages/db` Persistence Layer（資料庫存取層）與 `packages/application` Application Layer（應用服務層）。交易異動固定遵循：input → Draft（待確認草稿）→ deterministic validation（確定性資料驗證）→ explicit Confirmation（明確確認）→ commit；application service 不包含任何 LINE／LIFF presentation logic。

`transactions` 是唯一真相來源；`position_snapshots` 只是可重建的快照。`VOIDED` 交易不參與計算，reversal 以另一筆保留在 ledger 的相反交易表達，不刪除原始紀錄。缺少行情時不猜測市值或未實現損益，summary 會列出 `missingPriceInstrumentIds`。

Phase 1 使用 Decimal-safe arithmetic（Decimal 安全算術）計算加權平均成本、已實現／未實現損益、手續費與稅費。交易採 long-only（只允許持有多頭部位），賣出不可超過現有持倉；已確認交易不刪除，錯誤更正保留 `VOIDED`／reversal 語義。

## 專案結構

- `packages/domain`：純領域核心，不依賴 LINE、LIFF、React、Next.js 或 AI。
- `packages/db`：Drizzle schema 與 PostgreSQL migration。
- `apps/api`、`apps/worker`、`apps/dashboard`：未來 client/application 的可編譯骨架。
- `clients/mobile`：未來手機使用端 contract placeholder。

LIFF dashboard、market-data provider、AI Gateway 與 alert worker 會在後續 Phase 實作。
