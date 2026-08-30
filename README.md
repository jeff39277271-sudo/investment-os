# Investment OS

Investment OS 是以 LINE + LIFF 為 V1 入口的個人投資紀錄與研究系統。此 repository 目前完成 Phase 0 至 Phase 3C1 的既定範圍：TypeScript Monorepo（單一程式碼倉庫多模組架構）、PostgreSQL schema/migration、以 `transactions` 為唯一 source of truth（資產真相來源）的交易核心、LINE Messaging API（LINE 訊息 API）adapter、行情基礎層、價格警示規則，以及 Fugle live quote 的手動匯入路徑。

## 本機執行

需求：Node.js 22、pnpm 9、Docker Desktop（用於 PostgreSQL integration test）。

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed:dev
# 使用文字編輯器填入 .env 的 LINE_CHANNEL_SECRET 與 LINE_CHANNEL_ACCESS_TOKEN。
pnpm api:dev
```

`pnpm api:dev` 會先編譯 API，再由 Node.js 22 的 `--env-file` 從 repository root 載入 `.env`，以 watch mode 啟動 `apps/api/dist/main.js`。不需要逐一設定 PowerShell environment variables（環境變數）。預設監聽 `0.0.0.0:3000`；可在 `.env` 以 `PORT` 覆寫。

`pnpm db:seed:dev` 是明確的 Development Seed（開發用種子資料）命令，目前以 `(symbol, exchange)` unique key upsert `2330 台積電` 與 `0050 元大台灣50`。可重複執行且不會產生 duplicate rows（重複資料列）。此 seed 不含價格或行情同步，也不會由 production/API startup 自動執行。

啟動後可在另一個 PowerShell 視窗確認：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health | Select-Object StatusCode, Content
```

應回傳 HTTP 200 與 `{"status":"ok"}`。LINE webhook endpoint 為 `POST http://localhost:3000/webhooks/line`，仍要求有效的 `X-Line-Signature`。實際連接 LINE Developer Console 時，可再使用可信任的 HTTPS tunnel（HTTPS 通道）將 localhost 暴露為公開 HTTPS URL。

Production/start 使用 build output：

```powershell
pnpm build
pnpm api:start
```

`api:start` 不會隱藏 build 缺失或環境設定錯誤；缺少 `DATABASE_URL`、`LINE_CHANNEL_SECRET` 或 `LINE_CHANNEL_ACCESS_TOKEN` 時會指出缺少的變數並立即退出，但不會輸出 secret 值。停止 runtime 可使用 `Ctrl+C`；API 同時支援 `SIGINT` 與 `SIGTERM` graceful shutdown（優雅關閉）。

若要執行 PostgreSQL Integration Test（資料庫整合測試），請在 PowerShell 使用：

```powershell
$env:RUN_POSTGRES_INTEGRATION='true'
pnpm test
```

這組測試會實際建立 user、portfolio、instrument、draft 與 transaction，驗證 ownership、expiry、confirmation Idempotency（冪等性／避免同一操作被重複執行）、void／reversal 與 portfolio summary。未設定 `RUN_POSTGRES_INTEGRATION` 時，`pnpm test` 只執行不需外部服務的 domain tests；CI 或本機具備 PostgreSQL 時應設定它以執行完整測試。

`.env.example` 僅包含本機開發用的非 secret 設定名稱；請複製成 `.env` 後再依環境調整，禁止提交真實 token 或 API key。`.env` 已由 `.gitignore` 排除。

## Phase 2 LINE Integration（LINE 整合）

`POST /webhooks/line` 使用未解析的 raw body 與 `X-Line-Signature` 驗證 webhook。LINE `userId` 只用來查找 `user_identities`；application workflow 一律使用 internal `user_id`。首次使用者會以同一個 PostgreSQL transaction 建立 internal user、LINE identity 與主要投資組合。

Phase 2 parser 僅接受 `BUY 2330 100 1250`、`SELL 2330 50 1300` 及同格式的「買／賣」指令。指令只建立 server-side draft，Flex Message（彈性訊息）按鈕以 server-side `draftId` postback，確認與取消仍呼叫既有 application service。`line_webhook_events` 提供持久化 Idempotency（冪等性／避免同一操作被重複執行）；重送事件不會再建立 draft 或 transaction，失敗與逾時中的事件可安全重試。

正式環境需要設定 `LINE_CHANNEL_SECRET` 與 `LINE_CHANNEL_ACCESS_TOKEN`；`.env.example` 只保留空白欄位，不含 secrets。Phase 2 不包含 LLM、行情、警示、新聞、LIFF 或研究功能。

## Phase 3A Market Data Foundation（市場行情基礎層）

`packages/market-data` 定義 provider-agnostic Market Data Provider（供應商無關的行情介面）、Decimal-safe Quote（Decimal 安全行情模型）、Quote Freshness Policy（行情新鮮度政策）與僅限 development/test 的 `FakeMarketDataProvider`。目前 deterministic fake quote 為 `2330 = TWD 1300`、`0050 = TWD 60`；production 未設定 provider 時會明確失敗，且禁止以 fake provider 靜默 fallback。

PostgreSQL `instrument_quotes` 保存 provider quote history 與時間 metadata；`(instrument_id, source, quote_at)` 提供 ingestion Idempotency（行情寫入冪等性），latest quote 依 `quote_at`、`received_at`、`id` deterministic 選取。`transactions` 仍是 holdings source of truth（持倉唯一事實來源），quote 不會建立、修改或刪除交易。

Portfolio valuation（投資組合估值）由 application service 驗證 ownership 與 currency 後，以 transaction ledger 加 latest quote 呼叫既有 deterministic portfolio engine。回傳值保留 `missingPriceInstrumentIds`，並逐一揭露 `FRESH`、`STALE` 或 `MISSING`、quote timestamp 與 source；stale threshold 由 application 注入，不放在 presentation layer。

Phase 3A 刻意不新增 public portfolio/quote API route：目前尚無通用 session/auth API，僅憑 public `portfolioId` 會形成 ownership 漏洞。估值流程已由 application/PostgreSQL integration tests 驗證，待安全 client authentication 建立後再暴露 read-only route。本階段不包含 Fugle/TWSE live provider、WebSocket、alerts、LINE proactive notification、AI、news 或 LIFF。

## Phase 3B Alert Rules Engine（警示規則引擎）

`AlertApplicationService` 支援固定價格的 `STOP_LOSS` 與 `TAKE_PROFIT`，以及 create、update threshold、pause、resume、archive、owned read/list 與 deterministic evaluation（確定性判斷）。Rule（規則）以 Decimal-safe `triggerPrice`、`ACTIVE / PAUSED / ARCHIVED` status 與持久化 `CLEAR / BREACHED` condition state 表達；建立時必須驗證 portfolio ownership、instrument/currency 與當前持倉數量大於零。

觸發只發生在 `CLEAR → BREACHED`：STOP_LOSS 使用 `latestPrice <= triggerPrice`，TAKE_PROFIT 使用 `latestPrice >= triggerPrice`。持續 breach 不重複產生 event；價格恢復會 `BREACHED → CLEAR` re-arm（重新武裝），下一次 crossing 才能再次觸發。只有 `FRESH` quote 可以觸發；`STALE`、`MISSING`、無持倉、paused 與 archived 都回傳明確 skipped result，且 stale/missing 不改變 condition state。

PostgreSQL `alert_trigger_events` 是 immutable audit ledger（不可變觸發稽核流水帳），不是 notification delivery（通知投遞紀錄）。Evaluation 以 transaction + rule row `FOR UPDATE` lock，原子更新 condition state 並插入 event；`(alert_rule_id, quote_id)` unique constraint 防止同 rule/quote 併發重複觸發。Trigger 絕不建立 draft、transaction、broker order 或 LINE push。

Phase 3B 沒有新增 public alerts API 或 LINE command，因目前沒有完整 session/auth API。也不包含 live provider、polling、scheduler、worker、notification queue、percentage/trailing stop、AI、news 或 automatic trading。

## Phase 3C1 Fugle Live Market Provider（Fugle 真實行情供應商）

`FugleMarketDataProvider` 實作既有 `MarketDataProvider`，使用 instrument master 的 `providerSymbol` 呼叫 Fugle HTTP API 的 `GET /intraday/quote/{symbol}`，並以 `X-API-KEY` header 驗證。它將 `lastPrice` 以未先經過 JavaScript `Number` 的 Decimal-safe 方式正規化，並把 Fugle 的 microsecond `lastUpdated` 保存為 `quoteAt`、本機接收時間保存為 `receivedAt`。行情仍透過 `MarketDataApplicationService` 寫入既有 `instrument_quotes`；不直接操作 DB，也不會執行 alert evaluation、LINE push 或任何交易動作。

本機 development 可在 `.env` 使用 deterministic fake provider：

```dotenv
MARKET_DATA_PROVIDER=fake
MARKET_DATA_STALE_AFTER_MS=300000
```

要明確改用 Fugle 時，請自行在未納入 Git 的 `.env` 設定：

```dotenv
MARKET_DATA_PROVIDER=fugle
FUGLE_API_KEY=<your-api-key>
```

完成 `pnpm db:migrate` 與 `pnpm db:seed:dev` 後，可手動擷取並持久化單一商品行情：

```powershell
pnpm market:refresh 2330
```

命令會從 repository root `.env` 載入設定，輸出安全的 symbol、price、currency、`quoteAt`、`receivedAt`、source 與 freshness，不輸出 API key。`MARKET_DATA_PROVIDER` 未設定、設為 `none`、production 使用 `fake`，或 Fugle 缺少 `FUGLE_API_KEY` 時都會明確失敗，不會 silent fallback（靜默退回假資料）。Phase 3C1 是 manual ingestion path（手動行情匯入路徑）；沒有 scheduler、worker、alert notification、LINE market command 或 public quote API。

## Phase 3C2 Alert Worker + Notification Delivery（警示 Worker 與通知投遞）

Phase 3C2 提供 one-shot worker（單次執行 Worker）：取得 ACTIVE rules、依 instrument 去重更新行情、呼叫既有 `AlertApplicationService` 判斷 crossing，為新 `AlertTriggerEvent` 建立獨立的 `NotificationDelivery`，再透過既有 `LineMessagingClient` 主動推送 LINE。Trigger event 是市場條件事件；delivery 是通知稽核狀態，LINE 暫時失敗不會回滾 trigger 或 alert condition。

先在未提交的 root `.env` 設定：

```dotenv
DATABASE_URL=postgres://...
MARKET_DATA_PROVIDER=fugle
FUGLE_API_KEY=<set-locally>
LINE_CHANNEL_ACCESS_TOKEN=<set-locally>
MARKET_DATA_STALE_AFTER_MS=300000
```

Development/test 可明確使用 `MARKET_DATA_PROVIDER=fake`；production 仍禁止 fake。執行一次監控：

```powershell
pnpm alerts:run
```

輸出只包含安全的 structured summary（結構化摘要），例如 evaluated rules、refreshed/failed quotes、new triggers 與 delivered/failed notifications，不輸出 token、API key 或 database password。Delivery 以 `(alert_trigger_event_id, channel)` DB unique constraint 做 Idempotency（冪等性／避免重複執行），並以 claim、有限 attempt count、PROCESSING lease recovery 及固定 `X-Line-Retry-Key` 保護 concurrency/retry。

`pnpm alerts:run` 保持 manual one-shot（手動單次執行），不套用市場時段限制，方便明確的維運／debug 操作；Phase 3B 的 FRESH／STALE 安全判斷仍不可繞過。STOP_LOSS／TAKE_PROFIT 僅傳送「條件已觸發」通知，不建立 BUY/SELL draft 或 transaction。

## Phase 3C3 Scheduler + Market Hours Policy（排程器與市場時段政策）

`apps/worker` 提供獨立的 Scheduled Alert Monitoring Runtime（排程式警示監控執行程序）：啟動後立即執行第一個 market-session tick，完成後才等待下一個 interval，因此同一 process 不會 overlap。PostgreSQL `scheduler_leases` 以 job `ALERT_MONITORING`、owner、`locked_until` 實作跨 process atomic lease；有效 lease 不可被其他 scheduler 取得，執行期間會續租，crash 後則可在 lease expiry 後接手。

```dotenv
ALERT_MONITOR_INTERVAL_MS=60000
ALERT_SCHEDULER_LEASE_MS=120000
TW_MARKET_CLOSED_DATES=
```

`ALERT_MONITOR_INTERVAL_MS` 最低 1000 ms，預設 60000 ms；實際值應依使用者自己的 market-data plan／quota 調整，不代表 Fugle quota 建議。`ALERT_SCHEDULER_LEASE_MS` 預設 120000 ms，scheduler 會在長時間 worker run 中續租。`TW_MARKET_CLOSED_DATES` 接受以 Asia/Taipei market date 表示的逗號分隔 `YYYY-MM-DD`；repository 不預填或猜測假日。

目前 MarketSessionPolicy（市場交易時段政策）只支援 `market=TW` 且 exchange 為 `TWSE`／`TPEx`。依 [TWSE 官方交易制度](https://www.twse.com.tw/en/products/system/trading.html)與 [TPEx 官方交易制度](https://www.tpex.org.tw/en-us/mainboard/trading/rules/system.html)，regular session 使用 Asia/Taipei 週一至週五 `[09:00:00, 13:30:00)`：09:00 開始，13:30 boundary 已關閉。週末、configured closed date、session 外時間與 unsupported market 都不 refresh 行情、不 evaluate trigger、不呼叫 LINE。

Official TWSE holiday calendar adapter（證交所官方假日日曆介接）目前 **NOT IMPLEMENTED**；使用 explicit configured closed dates。即使設定遺漏休市日，Phase 3B quote freshness 仍是最後安全網，STALE quote 不會觸發。

啟動長駐 scheduler：

```powershell
pnpm alerts:schedule
```

停止可使用 `Ctrl+C`；runtime 支援 SIGINT／SIGTERM，會停止新 tick、等待 in-flight run 完成並關閉 PostgreSQL resources。單次 worker 暫時失敗會輸出 safe structured log，下一 cadence 繼續。Production 仍禁止 fake provider fallback。

Phase 3C3 只是 production-capable runtime，**不代表已部署或 24/7 運作**；只有實際啟動 `pnpm alerts:schedule` 才會持續監控。目前沒有 cloud deployment、Windows Task Scheduler、cron、public scheduler API 或自動交易。LINE proactive push 是 worker 對 LINE API 的 outbound request，不需要 Cloudflare tunnel；tunnel 僅用於 LINE inbound webhook 連到本機 API。

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
