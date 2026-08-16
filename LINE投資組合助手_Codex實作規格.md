# LINE 投資組合助手 — Codex 實作規格

版本：v0.6  
目標：建立一個多 Client（使用端／客戶端） 的個人投資作業系統。V1 以 LINE 作為快速自然語言／通知入口、LIFF（LINE Front-end Framework／LINE 內嵌網頁框架） 作為完整投資儀表板；未來可新增獨立手機 App，而不重寫投資、風險、警示、情報與 AI 核心。

---


## 專有名詞中文註解規範

為降低工程文件閱讀門檻，所有重要英文專有名詞在**第一次出現時**應使用：

```text
English Term（中文註解）
```

例如：

```text
Domain Layer（領域核心層）
Transaction Ledger（交易流水帳／交易唯一事實來源）
Idempotency（冪等性／避免同一操作被重複執行）
AI Gateway（AI 統一介接層）
LIFF（LINE Front-end Framework／LINE 內嵌網頁框架）
```

規則：

1. 同一段落或同一表格中重複出現時，不必每次都加中文。
2. 程式碼、class 名稱、interface 名稱、enum、API（應用程式介面） route、資料表欄位不翻譯，以免破壞工程可執行性。
3. 文件說明文字、UI 規格、架構圖說明必須優先提供中文註解。
4. 若中文翻譯容易造成誤解，保留英文並用中文解釋用途。
5. Codex 新增文件時也必須遵循本規則。
6. 完整詞彙定義以 `GLOSSARY_ZH_TW.md` 為準。


## 1. 產品定位

這是一個「個人投資紀錄＋研究助手」，不是券商下單系統。

核心原則：

1. **交易紀錄是唯一資產真相來源（source of truth）**。
2. **持股、成本、損益、風險、警示條件全部由確定性程式計算，不由 LLM（大型語言模型） 計算或保存。**
3. AI / LLM 負責：
   - 複雜自然語言理解。
   - 對話流程與研究問題路由。
   - 新聞／市場資訊的分類、聚類輔助與整理。
   - 個股／產業／投資組合的解釋性分析。
   - 簡單交易與警示指令優先由 deterministic parser 處理，解析失敗或語意複雜時才交給 LLM。
4. 所有會修改資料的操作，例如買進、賣出、修改停損，無論來自 LINE、LIFF 或未來手機 App，都必須先建立 server-side draft、顯示確認介面，再由使用者確認。
5. MVP 不做自動下單、不串接券商交易權限。
6. 所有市場與公司資訊都要帶 `as_of`、來源與資料新鮮度；缺資料時不得猜測。
7. 「市場熱門標的」只能定義為研究候選，不可因新聞熱度直接變成買進建議。

---

## 2. MVP 範圍

### P0 — 必須完成

- LINE Official Account + Messaging API webhook。
- LINE Rich Menu（LINE 圖文選單），採分層選單與快捷操作。
- LINE Flex Message（LINE 彈性訊息卡片）。
- 持股重大消息主動通知。
- 市場最新資訊濃縮精華。
- 買進紀錄。
- 賣出紀錄。
- 交易歷史。
- 持股與平均成本。
- 當前市值。
- 未實現損益。
- 已實現損益。
- 停利價設定。
- 停損價設定。
- 價格觸發後 LINE Push 通知。
- 投資組合摘要。
- LIFF 投資組合儀表板。
- Provider-agnostic AI Gateway（AI 統一介接層） 對話路由；V1 不硬依賴 OpenAI API。
- 台股即時行情 provider adapter。
- 台股 Fugle WebSocket（即時雙向連線） 實作。
- TWSE OpenAPI adapter。
- 基礎安全與稽核紀錄。
- 自動測試。

### P1 — 第二階段

- 市場焦點／熱門族群。
- 每日市場精華摘要。
- 重大市場事件即時摘要。
- 持股重大消息監控。
- Watchlist（觀察名單） 重大消息監控。
- 研究候選標的。
- 個股基本面摘要。
- 公司財務體質分析。
- 投資組合風險分析。
- Watchlist。
- Thesis（投資論點） Tracker（投資論點追蹤器）。
- 每日市場摘要。
- 美國市場行情 provider adapter。
- 多幣別投資組合。
- 歷史績效圖。
- 相關性／集中度／波動風險。

### P2 — 後續

- 券商成交紀錄自動匯入。
- CSV / Excel 匯入。
- Trailing stop。
- 多投資組合。
- 多使用者。
- 更完整的 DCF（現金流折現估值） / comps。
- 財報事件與法說追蹤。
- 自訂策略警示。

---

## 3. 明確不做

MVP 不實作：

- 自動買進。
- 自動賣出。
- 券商下單。
- 保證獲利模型。
- 單純因新聞熱度給「買進」結論。
- LLM 直接修改持股數量。
- LLM 自己計算成本基礎後寫入 DB。
- 依 Web 搜尋結果當成即時成交價。
- 未經確認的資料寫入。

---

## 3.1 Client 策略

本產品從第一天就採 **Backend-first（後端優先架構） / Multi-client architecture（多使用端架構）**。

### V1

```text
LINE
├─ 自然語言快速操作
├─ Rich Menu / Flex Message
├─ 停利停損通知
├─ 持股重大消息通知
└─ 市場精華推播

LIFF Web App
├─ Portfolio Dashboard
├─ Risk
├─ Intelligence
├─ Research
├─ Thesis
└─ Natural-language Command Bar
```

### Future

```text
Native / Cross-platform Mobile App
├─ 深度 Dashboard
├─ 原生 Push
├─ Biometrics
├─ 更完整圖表與互動
└─ 與 LINE 共用同一 Backend
```

### 非談判原則

- LINE 不是 domain layer。
- LIFF 不是 domain layer。
- 未來 App 也不是 domain layer。
- 所有 business logic 都必須透過共用 application/domain services。
- Client 只負責輸入、呈現、身份驗證與 user interaction。
- 新增手機 App 應是「新增 Client」，不是「重寫產品」。

詳細規格見：

```text
MULTI_CLIENT_ARCHITECTURE.md
```

## 4. 使用者介面

LINE 不只提供單一 2 × 3 選單，而是採「主選單 + 子選單 + Flex Message 動作卡」三層設計。

### 4.1 主選單

建議第一版 Rich Menu：

| 按鈕 | 行為 |
|---|---|
| 投資組合 | `postback: menu.portfolio` |
| 交易紀錄 | `postback: menu.transactions` |
| 警示中心 | `postback: menu.alerts` |
| 市場情報 | `postback: menu.market` |
| 個股研究 | `postback: menu.research` |
| 儀表板 | 開啟 LIFF URL |

### 4.2 投資組合子選單

Flex Message：

- 今日總覽。
- 持股明細。
- 投資組合風險。
- 損益。
- 資產配置。
- 持股重大消息。
- 開啟完整 Dashboard。

### 4.3 交易子選單

- 記錄買進。
- 記錄賣出。
- 查看交易紀錄。
- 更正交易。
- 匯入資料（P1）。

### 4.4 警示中心子選單

- 設定停利。
- 設定停損。
- 查看啟用警示。
- 已觸發警示。
- 重大消息通知設定。
- 每日市場摘要設定。

### 4.5 市場情報子選單

- 今日市場精華。
- 台股焦點。
- 美股焦點。
- AI / 科技。
- 產業熱門族群。
- 宏觀 / 利率 / 匯率。
- 我的持股相關消息。
- 研究候選標的。

### 4.6 個股研究子選單

使用者輸入或選擇 ticker 後：

- 快速體檢。
- 最新重大消息。
- 財務體質。
- 估值比較。
- 催化劑 / 風險。
- 我的持股影響。
- 加入觀察名單。
- 建立 / 查看 Thesis。

### 4.7 選單原則

- 使用 stable action code，不依顯示文字做 routing。
- 子選單以 Flex Message / postback 為主，避免 Rich Menu 過度擁擠。
- 常用操作最多 2 次點擊即可完成。
- 任一層都保留：
  - 返回上一層。
  - 回主選單。
- 使用者仍可直接輸入自然語言，不強迫只能使用選單。
- 選單與自然語言最終都 route 到同一 domain workflow。


## 4.8 Natural Language — 第一級操作入口

LINE 的文字輸入不是選單的備援，而是與選單同等重要的主入口。

所有主要功能必須能同時由：

```text
Rich Menu / Flex postback
```

或：

```text
natural language
```

觸發，並 route 到同一個 domain workflow。

例如：

```text
「今天買台積電100股1250」
→ TRANSACTION_BUY
→ draft
→ confirmation card
→ commit
```

```text
「今天市場最重要的5件事」
→ MARKET_DIGEST
→ latest sources
→ intelligence pipeline
→ summary
```

```text
「台積電跌破1180提醒我」
→ ALERT_CREATE_STOP_LOSS
→ draft
→ confirmation
→ alert rule
```

```text
「我的持股最近有什麼重大消息」
→ HOLDING_NEWS
→ holdings
→ clustered material events
→ portfolio relevance
→ response
```

支援 contextual follow-up：

```text
User: 分析台積電
User: 那估值呢？
User: 最近有重大消息嗎？
```

後兩句必須沿用目前 active instrument。

詳細互動與安全規格見：

```text
UIUX_AND_NATURAL_LANGUAGE_SPEC.md
```


## 5. 對話流程

### 5.1 快速自然語言交易紀錄

使用者：

> 今天買 2330 100 股，成交價 1250

流程：

1. LLM 只做 slot extraction。
2. 產生結構化 draft：
   - side = BUY
   - symbol = 2330
   - quantity = 100
   - price = 1250
   - trade_at = today
3. 後端查詢 instrument。
4. Flex Message 顯示：
   - 台積電 2330
   - 買進 100 股
   - 1250 TWD
   - 預估成交額
   - 日期
5. 顯示：
   - 確認
   - 修改
   - 取消
6. 只有「確認」才建立 transaction。

禁止直接依自然語言建立正式交易紀錄。

### 5.2 賣出

流程與買進相同，但在確認前要檢查：

- 持股是否足夠。
- 是否允許負持股。
- MVP 預設不允許負持股。

### 5.3 停利停損

使用者：

> 2330 停損 1180，停利 1400

轉成 draft：

```json
{
  "symbol": "2330",
  "rules": [
    {"type": "PRICE_BELOW", "threshold": 1180},
    {"type": "PRICE_ABOVE", "threshold": 1400}
  ]
}
```

確認後才正式建立。

### 5.4 投資組合查詢

輸出 Flex Message：

- 總市值。
- 今日損益。
- 總未實現損益。
- 最大持股。
- 前 3 大部位。
- 目前啟用警示數。
- 「查看完整儀表板」。

### 5.5 市場焦點

步驟：

1. 搜尋近期市場新聞與討論。
2. 聚類成 3–5 個主題。
3. 每個主題說明：
   - 為什麼現在受到注意。
   - 主要驅動因素。
   - 哪些公司真正有營收／訂單／獲利曝險。
   - 哪些只是題材連結。
4. 產生候選池：
   - A：值得立即深入研究。
   - B：觀察名單／等待觸發。
   - C：只有題材訊號。
   - Reject：缺乏實質曝險或風險報酬不佳。
5. 不將候選池等同投資建議。

### 5.6 個股分析

使用者輸入 ticker 後，先讓使用者選：

- 快速體檢。
- 深度分析。
- 估值比較。
- 我的持股影響。

快速體檢至少包含：

- 公司做什麼。
- 核心營收來源。
- 獲利驅動。
- 毛利率／營益率趨勢。
- 現金流。
- 負債與流動性。
- ROE / ROIC（資料可得時）。
- 估值背景。
- 催化劑。
- 主要風險。
- 資料缺口。
- 資料日期與來源。

---

## 6. 投資分析工作流

### 6.1 Public Equity Investing — 主分析框架

#### A. `portfolio_risk`

用途：

- 持股集中度。
- 單一公司風險。
- 產業集中度。
- 地區／幣別集中度。
- 最大回撤。
- 波動。
- 相關性群組。
- 流動性。
- 警示點對應的 downside budget。

輸出必須區分：

- 已知資料。
- 計算結果。
- 推論。
- 缺少資料。
- 需要重新評估的條件。

#### B. `idea_generation`

用途：

- 市場熱門議題。
- 產業族群。
- 新研究標的。

每個候選必須有：

- Why now。
- Exposure（曝險） proof。
- Expectations risk。
- First rejection。
- What would make it investable。
- What would kill it。
- Next research step。

#### C. `company_tearsheet`

用途：

- 公司快速體檢。
- 事業與財務基線。
- 估值背景。
- 催化劑與風險。

#### D. `thesis_tracker`

用途：

- 已持有股票。
- Watchlist。
- 持續更新投資論點。

每筆 thesis：

- 原始 thesis。
- 核心 pillars。
- KPI。
- catalyst。
- warning threshold。
- kill criteria。
- evidence ledger。
- last_reviewed_at。
- next_review_at。

---

## 6.2 Investment Banking — 輔助分析框架

Investment Banking 不作為個人股票買賣決策 owner。

只在以下需求加入：

- EV（企業價值） → Equity bridge。
- 資本結構。
- 淨負債。
- 同業交易倍數比較。
- Comparable company normalization。
- DCF / comps 的結構化估值。
- 重大融資／併購對股權價值的影響。

最終股票投資判斷仍回到 Public Equity Investing workflow。

---

## 7. 主動情報通知系統

這是獨立於價格 Alert Engine（警示引擎） 的第二種通知系統。

### 7.1 Holdings News Watcher

目的：

> 主動發現「已持有股票」或 Watchlist 出現可能影響投資論點、估值、風險或價格的重要事件。

監控事件包括：

- 財報公布。
- 月營收 / 營收重大變動。
- 公司重大訊息。
- 法說會 / guidance。
- 盈餘預警。
- 大額訂單。
- 重要客戶 / 供應商變化。
- 併購。
- 增資 / 減資 / 可轉債 / 公司債。
- 股利政策重大改變。
- 董監 / 經營層重大異動。
- 訴訟 / 監管 / 制裁。
- 重大事故 / 停工。
- 產品事故。
- 評級 / 目標價大幅變動（僅在可靠來源可得時）。
- 產業政策直接影響。
- 地緣政治直接曝險。
- 其他可能改變 thesis 的事件。

### 7.2 News Watcher 流程

```text
scheduler / source event
    ↓
讀取 holdings + watchlist
    ↓
取得新消息
    ↓
normalize
    ↓
entity / ticker mapping
    ↓
去重
    ↓
source quality score
    ↓
materiality score
    ↓
portfolio relevance score
    ↓
LLM classification + summary
    ↓
是否達通知門檻？
    ├─ No → 存入 digest queue
    └─ Yes
         ↓
      LINE Push
         ↓
      thesis evidence candidate
```

### 7.3 重要性分數

不得「有新聞就通知」。

建議 deterministic + LLM 混合評分：

```text
materiality_score = 0–100
portfolio_relevance_score = 0–100
source_quality_score = 0–100
novelty_score = 0–100
```

最後：

```text
priority_score =
  0.35 * materiality
+ 0.30 * portfolio_relevance
+ 0.20 * source_quality
+ 0.15 * novelty
```

具體權重可配置，不能寫死在 prompt。

### 7.4 通知等級

#### CRITICAL

立即推播。

典型：

- 重大財測下修。
- 突發停工。
- 重大監管事件。
- 重大併購。
- 重大財報 miss / beat 且可能改變 thesis。
- 重大資本結構事件。

#### HIGH

盡快推播。

#### MEDIUM

不立即打擾，放入下一份市場 / 持股摘要。

#### LOW

只入資料庫，不推播。

### 7.5 持股消息通知格式

Flex Message：

```text
🔴 持股重大消息

2330 台積電
重要性：HIGH
時間：2026-xx-xx xx:xx

發生什麼：
...

為什麼跟你有關：
- 目前投資組合權重：xx%
- 可能影響：營收 / 毛利 / 估值 / 風險

初步判讀：
Positive / Negative / Mixed / Unclear

這是否改變原投資論點：
Likely / Possible / No evidence yet

[查看完整分析]
[查看持股]
[加入 Thesis 證據]
[稍後提醒]
```

### 7.6 去重與事件聚類

同一事件可能有 20 家媒體報導。

必須：

- canonicalize URL。
- title similarity。
- entity + event type。
- publication timestamp。
- semantic similarity。
- event cluster ID。

同一 cluster 預設只推播一次。

若後續有新的「實質資訊」才允許更新推播。

### 7.7 通知偏好

`notification_preferences`：

```text
user_id
critical_enabled
high_enabled
medium_digest_enabled
quiet_hours_start
quiet_hours_end
holdings_news_enabled
watchlist_news_enabled
daily_digest_enabled
daily_digest_time
market_event_enabled
created_at
updated_at
```

CRITICAL 是否忽略 quiet hours 要做成使用者設定，不硬編碼。

---

## 8. 市場情報精華系統

### 8.1 目標

不是提供大量新聞，而是回答：

> 今天真正值得知道的是什麼？  
> 為什麼市場在討論？  
> 對哪些產業與公司有影響？  
> 哪些只是敘事，哪些已經有基本面證據？

### 8.2 情報來源類型

依可靠度排序：

1. 公司公告 / IR / 法說 / 財報。
2. 交易所 / 政府 / 央行 / 監管機構。
3. 高品質新聞來源。
4. 市場資料與產業資料。
5. 其他公開來源。

社群討論可用於判斷「市場正在談什麼」，但不得單獨作為基本面證據。

### 8.3 Market Intelligence（市場情報） Pipeline

```text
sources
  ↓
collect recent items
  ↓
normalize
  ↓
dedupe
  ↓
topic clustering
  ↓
importance ranking
  ↓
market impact classification
  ↓
beneficiary / loser mapping
  ↓
exposure proof
  ↓
portfolio overlap
  ↓
LLM synthesis
  ↓
LINE / Dashboard
```

### 8.4 今日市場精華

建議固定只顯示 5–8 個最重要主題。

每則：

```text
主題
一句話結論
發生什麼
市場為什麼在意
主要受益 / 受害族群
值得研究的公司
對我的持股影響
後續觀察點
來源
as-of
```

### 8.5 三層摘要

#### Level 1 — 30 秒版

LINE 首屏：

- 5 大市場事件。
- 3 個最值得注意產業。
- 我的持股 1–3 個重點。

#### Level 2 — 3 分鐘版

點「展開」：

- 事件脈絡。
- 市場影響。
- 族群與公司。
- 風險。

#### Level 3 — 深度研究

點公司後：

- company tearsheet。
- valuation。
- thesis。
- portfolio impact。

### 8.6 每日摘要

使用者可設定時間。

範例：

```text
📊 今日投資情報

市場主線
1. ...
2. ...
3. ...

熱門族群
- AI server
- 半導體設備
- ...

研究候選
A:
- xxx
- xxx

我的持股
- 2330：...
- 2308：...

今日風險
- ...

今日要追
- 14:30 ...
- 明日 ...
```

### 8.7 即時重大市場事件

如果不是單一持股，而是足以影響整個市場：

- 央行突發政策。
- 重大地緣政治。
- 關稅。
- 大型科技公司關鍵財測。
- 重大金融風險。
- 市場交易中斷。

可以觸發：

```text
MARKET_CRITICAL
```

但同樣需要重要性門檻與去重。

---

## 9. 情報資料庫

### `news_items`

```text
id UUID PK
canonical_url TEXT
title TEXT
source TEXT
source_type TEXT
published_at TIMESTAMP
retrieved_at TIMESTAMP
content_hash TEXT
raw_summary TEXT NULL
language TEXT
```

### `news_entities`

```text
news_item_id
instrument_id NULL
entity_name
relationship_type
confidence
```

### `news_clusters`

```text
id
event_type
canonical_title
first_seen_at
last_seen_at
materiality_score
source_quality_score
novelty_score
status
```

### `news_cluster_items`

```text
cluster_id
news_item_id
```

### `portfolio_news_relevance`

```text
cluster_id
portfolio_id
instrument_id NULL
relevance_score
impact_direction
impact_type
thesis_change_probability
reason
created_at
```

### `notification_events`

```text
id
user_id
notification_type
cluster_id NULL
instrument_id NULL
priority
dedupe_key UNIQUE
sent_at NULL
delivery_status
payload_json
created_at
```

### `market_digests`

```text
id
user_id
period_start
period_end
digest_type
summary_json
source_count
as_of
created_at
```

---

## 10. 排程

至少支援：

```text
holdings_news_scan:
  every 5–15 minutes

market_critical_scan:
  every 5–15 minutes

daily_market_digest:
  user-configured local time

thesis_review_scan:
  daily
```

實際頻率依資料 provider、成本與 rate limit 調整。

不要讓 LLM 自己當 scheduler。

---

## 11. 系統架構

```text
                         ┌────────────────────────┐
                         │   Shared Backend API   │
                         └────────────┬───────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
         ▼                            ▼                            ▼
    LINE Client                  LIFF Client                 Future Mobile
  quick actions / NL           V1 control panel             native client
  notifications               dashboard / research          not in V1
         │                            │                            │
         └────────────────────────────┼────────────────────────────┘
                                      ▼
                          Application / Domain Layer
                         ├─ Portfolio Engine
                         ├─ Transaction Ledger
                         ├─ Risk Engine
                         ├─ Alert Engine
                         ├─ Intelligence Engine
                         ├─ Research Workflows
                         ├─ Thesis Engine
                         └─ Command / Intent Service
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
      PostgreSQL               Provider Adapters             Job Workers
                               ├─ Market Data                ├─ price alerts
                               ├─ News / Public Data         ├─ news scans
                               ├─ AI Gateway                 ├─ digests
                               └─ Notification               └─ recovery
```

### Client adapters

```text
clients/
├─ line
│  ├─ webhook
│  ├─ rich-menu
│  ├─ flex
│  └─ push
├─ liff
│  ├─ auth
│  ├─ dashboard
│  └─ command-bar
└─ mobile                # future only
```

所有 Client 都呼叫相同 application services。

### AI Gateway

```text
AI Gateway
├─ DeterministicCommandParser
├─ LocalLLMProvider      # recommended default path
├─ CloudLLMProvider      # optional
└─ MockLLMProvider       # tests
```

OpenAI 只允許作為未來可選 adapter，不得成為 domain hard dependency。

### Notification（通知） abstraction

```text
NotificationService
├─ LineNotificationProvider      # V1
└─ MobilePushProvider            # future
```

Price alert / holdings news / market digest 先產生 domain notification event，再由 channel provider 傳送，避免業務邏輯綁死 LINE。

### Identity abstraction

V1 使用 LINE / LIFF identity，但 `users` 不直接等同 `line_user_id`。

```text
User
└─ UserIdentity
   ├─ LINE
   └─ future MOBILE_AUTH
```

未來新增 App 登入時，不需要 migration 整個 user model。

## 12. 建議技術棧

Monorepo（單一程式碼倉庫多模組架構）：

- TypeScript。
- pnpm workspaces。
- Node.js。
- API：Fastify。
- LIFF Dashboard：React / Next.js。
- 未來 Mobile App：預留 client contract；V1 不選 Flutter / React Native / native stack，待產品驗證後決定。
- Database：PostgreSQL。
- ORM：Prisma 或 Drizzle，Codex 選一個後全專案統一。
- Validation（資料驗證）：Zod。
- Tests：Vitest。
- E2E（端到端測試）：Playwright。
- Logging：Pino。
- Container：Docker。
- CI（持續整合）：GitHub Actions。

V1 部署時至少拆成：

1. API service。
2. long-running worker。
3. LIFF dashboard。
4. PostgreSQL。
5. 可選 Local LLM（本地大型語言模型） service（若使用自架模型）。

未來 Mobile App 不需要新的 domain/backend，只新增 client build 與 mobile notification provider。

**不要把即時行情 WebSocket worker 綁在短生命週期的 serverless request function。**

---

## 13. Repository（程式碼專案倉庫） 結構

```text
investment-os/
├─ AGENTS.md
├─ README.md
├─ .env.example
├─ package.json
├─ pnpm-workspace.yaml
├─ docker-compose.yml
│
├─ apps/
│  ├─ api/
│  ├─ worker/
│  └─ liff/
│
├─ clients/
│  ├─ line/
│  │  ├─ webhook/
│  │  ├─ flex/
│  │  ├─ rich-menu/
│  │  └─ notifications/
│  └─ mobile/
│     └─ README.md       # future client contract only
│
├─ packages/
│  ├─ db/
│  ├─ domain/
│  ├─ application/
│  ├─ auth/
│  ├─ commands/
│  ├─ market-data/
│  ├─ intelligence/
│  ├─ research/
│  ├─ notifications/
│  ├─ ai-gateway/
│  └─ shared/
│
├─ prompts/
└─ docs/
   ├─ architecture.md
   ├─ data-model.md
   ├─ client-contract.md
   ├─ line-flows.md
   ├─ ai-workflows.md
   └─ deployment.md
```

核心規則：

- `packages/domain` 不得 import LINE、React、Next.js、mobile SDK。
- `clients/line` 不得直接計算 portfolio state。
- `apps/liff` 不得直接操作 DB。
- 未來 `clients/mobile` 必須透過既有 API/application contracts。
- Client-specific DTO 可以不同，但 domain models 保持共用。

## 14. Database schema

### `users`

```text
id UUID PK
display_name TEXT NULL
timezone TEXT DEFAULT Asia/Taipei
base_currency TEXT DEFAULT TWD
created_at TIMESTAMP
updated_at TIMESTAMP
```

`users` 是產品內部 identity，不綁定任何單一 Client。

### `user_identities`

```text
id UUID PK
user_id UUID FK
provider ENUM(LINE, MOBILE_AUTH)
provider_subject TEXT
metadata_json JSONB NULL
created_at TIMESTAMP
updated_at TIMESTAMP
UNIQUE(provider, provider_subject)
```

V1 使用 LINE identity；未來 App 可增加新的 identity provider，而不改寫 Portfolio（投資組合） domain。

### `portfolios`

```text
id UUID PK
user_id UUID FK
name TEXT
base_currency TEXT
created_at
```

### `instruments`

```text
id UUID PK
symbol TEXT
name TEXT
exchange TEXT
market TEXT
currency TEXT
asset_type TEXT
provider_symbol TEXT
UNIQUE(symbol, exchange)
```

### `transactions`

此表是資產 source of truth。

```text
id UUID PK
portfolio_id UUID FK
instrument_id UUID FK
side ENUM(BUY, SELL)
quantity DECIMAL
price DECIMAL
currency TEXT
fee DECIMAL DEFAULT 0
tax DECIMAL DEFAULT 0
trade_at TIMESTAMP
source ENUM(LINE, LIFF, MOBILE_APP, IMPORT, MANUAL)
status ENUM(CONFIRMED, VOIDED)
reversal_of UUID NULL
note TEXT NULL
created_at TIMESTAMP
```

規則：

- 不直接刪除已確認交易。
- 錯誤更正採 VOID / reversal。
- position 由 transactions 推導。
- 可以做 position snapshot cache，但 cache 不可成為真相來源。

### `position_snapshots`

```text
portfolio_id
instrument_id
quantity
average_cost
realized_pnl
last_price
market_value
unrealized_pnl
calculated_at
```

可重建。

### `alert_rules`

```text
id UUID PK
user_id UUID FK
portfolio_id UUID FK
instrument_id UUID FK
type ENUM(
  PRICE_ABOVE,
  PRICE_BELOW,
  PCT_ABOVE_COST,
  PCT_BELOW_COST
)
threshold DECIMAL
baseline_price DECIMAL NULL
state ENUM(ARMED, TRIGGERED, DISABLED)
repeat_mode ENUM(ONCE, CROSSING)
cooldown_seconds INT
last_triggered_at TIMESTAMP NULL
created_at
updated_at
```

### `alert_events`

```text
id UUID PK
alert_rule_id UUID FK
observed_price DECIMAL
observed_at TIMESTAMP
event_key TEXT UNIQUE
line_message_id TEXT NULL
delivery_status TEXT
created_at
```

### `watchlists`

```text
id
user_id
name
created_at
```

### `watchlist_items`

```text
watchlist_id
instrument_id
reason
created_at
```

### `theses`

```text
id
user_id
instrument_id
status
security_readiness
original_thesis
pillars_json
kpis_json
catalysts_json
kill_criteria_json
last_reviewed_at
next_review_at
```

### `thesis_evidence`

```text
id
thesis_id
event_date
source
as_of
fact
signal
pillar
impact
created_at
```

### `analysis_runs`

```text
id
user_id
workflow
instrument_id NULL
request_text
model
source_summary_json
result_json
as_of
created_at
```

---

## 15. 成本與持股計算

MVP 預設：

- Long-only。
- 不允許賣超。
- 顯示成本採 weighted-average cost。
- 交易費與稅獨立紀錄。
- 所有 Decimal 使用 decimal library，不用 JS float 做金額核心計算。

交易流程：

```text
BUY:
new_qty = old_qty + buy_qty
new_avg_cost =
  (old_qty * old_avg_cost + buy_qty * buy_price + allocated_costs)
  / new_qty

SELL:
validate sell_qty <= current_qty
realized_pnl =
  sell_qty * (sell_price - avg_cost)
  - allocated_fees
  - taxes

remaining avg_cost:
保持不變
```

成本邏輯必須有 unit tests。

---

## 16. Market Data（市場行情資料） Provider（服務供應介面）（市場資料供應介面） abstraction

```ts
interface MarketDataProvider {
  getQuote(instrument: Instrument): Promise<Quote>;
  getHistoricalBars(
    instrument: Instrument,
    range: HistoricalRange
  ): Promise<Bar[]>;
  subscribeQuotes(
    instruments: Instrument[],
    onQuote: (quote: Quote) => void
  ): Promise<Subscription>;
}
```

### 台股

第一個 implementation：

- Fugle WebSocket：警示用即時行情。
- Fugle REST（REST API／網路資料介面）：snapshot / historical。
- TWSE OpenAPI：
  - 上市公司基本資料。
  - 每日重大訊息。
  - 每日成交資料。
  - P/E、殖利率、P/B。
  - 市場統計。

資料物件一定要帶：

```ts
type SourcedValue<T> = {
  value: T;
  source: string;
  asOf: string;
  retrievedAt: string;
};
```

### 美國市場

資料模型從一開始支援：

- market = US
- currency = USD
- provider adapter

但可排在 P1。

---

## 17. Alert Engine

### 核心流程

```text
worker start
  ↓
load ARMED alert rules
  ↓
group instruments by provider
  ↓
subscribe prices
  ↓
receive quote
  ↓
evaluate all matching rules
  ↓
detect crossing
  ↓
DB transaction / idempotency check
  ↓
create alert_event
  ↓
mark rule according to repeat mode
  ↓
LINE push
```

### Crossing（價格穿越條件），不是單純 `price <= threshold`

例如停損：

```text
last_price > threshold
AND
current_price <= threshold
```

用 crossing 可以避免每個 tick 都重複通知。

### 防重複

`event_key` 建議：

```text
{rule_id}:{crossing_direction}:{market_session_date}:{sequence}
```

DB unique constraint。

### ONCE

觸發後：

```text
state = TRIGGERED
```

### CROSSING

觸發後保留 ARMED，但要：

- 等價格回到門檻另一側才重新 arm。
- cooldown。

### Worker（背景工作程序） restart

啟動時：

1. 讀 active rules。
2. 拉 snapshot。
3. 初始化 last side。
4. 再接 websocket。

不得因重啟而重發同一 crossing。

---

## 18. LINE 通知

警示訊息 Flex Message：

```text
⚠️ 價格警示

2330 台積電
目前：1,178
條件：跌破 1,180
平均成本：1,245
部位：15.8%
未實現損益：-5.4%

[查看投資組合]
[查看個股分析]
[停用此警示]
```

價格警示是資訊通知，不執行交易。

---

## 19. LIFF Dashboard

### Header

- Portfolio name。
- NAV（淨資產價值／投資組合總值）。
- 今日 P/L（損益）。
- 總 P/L。
- Data as-of（資料截至時間）。

### Overview

- Asset allocation donut。
- Holdings bar。
- Equity curve。
- 今日變化。

### Holdings

欄位：

- Symbol。
- Name。
- Quantity。
- Avg cost。
- Current price。
- Market value。
- Unrealized P/L（未實現損益）。
- Weight。
- Stop loss。
- Take profit。

### Risk

第一版：

- Top position weight。
- Top 3 weight。
- HHI（赫芬達爾－赫希曼集中度指數）。
- Sector concentration。
- Country concentration。
- Currency concentration。
- Active stop downside。
- Rolling volatility。
- Max drawdown。

後續：

- Beta。
- Correlation（相關性） matrix。
- factor exposures。
- scenario stress。

### Alerts

- Active。
- Triggered。
- Disabled。
- Last notification。

### Research

- Watchlist。
- Thesis status。
- Latest market themes。
- Latest analysis。

---

## 20. Identity / LINE / LIFF Auth

Webhook（事件回呼機制）：

- 必須驗證 LINE webhook signature。
- 驗證失敗直接 401。
- raw body 驗證後才 parse。

LIFF：

1. LIFF client 取得 ID token。
2. 將 raw ID token 送 server。
3. server 向 LINE 驗證。
4. 只用 server 驗證後得到的 `sub` 當 user identity。
5. 不信任 client 傳來的 `line_user_id`。

Session（工作階段）：

- 驗證 LINE / LIFF identity 後轉成 internal `user_id`。
- API authorization 一律使用 internal user identity，不直接依賴 client-provided LINE ID。
- 可使用 app session JWT（JSON Web Token／登入權杖） / secure cookie。
- TTL 短。
- dashboard API 必須做 user ownership check。

### Future mobile auth

未來手機 App 只能新增新的 identity provider / session flow。

不得建立第二套 users / portfolio ownership。

---

## 21. AI Gateway

AI 不是必要的資料真相來源，且 V1 不硬依賴 OpenAI API。

### Routing order

```text
user input
↓
deterministic command parser
├─ high-confidence simple command → domain workflow
└─ ambiguous / complex language → AI Gateway
```

### Provider interface

```ts
interface LLMProvider {
  healthCheck(): Promise<ProviderHealth>;
  classifyIntent(input: IntentInput): Promise<IntentResult>;
  extractStructured<T>(input: StructuredInput<T>): Promise<T>;
  generate(input: GenerationInput): Promise<GenerationResult>;
}
```

Implementations：

```text
LocalLLMProvider
MockLLMProvider
CloudLLMProvider (optional)
OpenAIProvider (optional; not required)
```

推薦 V1 可先使用本地模型端點，但 domain 不得依賴特定供應商。

### Search / data separation

```text
Market / News Providers
↓
normalized evidence
↓
AI Gateway
↓
summary / interpretation
```

最新市場事實由 provider / official source 負責，AI 只負責理解與表達。

## 22. AI Router

輸入：

```json
{
  "user_message": "...",
  "active_flow": "...",
  "portfolio_context": "...",
  "allowed_tools": ["..."]
}
```

輸出 Structured Output（結構化輸出）：

```json
{
  "intent": "TRANSACTION_BUY | TRANSACTION_SELL | PORTFOLIO | ALERT | MARKET_RESEARCH | COMPANY_RESEARCH | DASHBOARD | OTHER",
  "confidence": 0.0,
  "slots": {},
  "needs_confirmation": false,
  "next_action": ""
}
```

低信心時不要寫 DB。

---

## 23. Research prompts

### 共通要求

每個分析 prompt 必須要求：

1. 先列資料日期。
2. 區分：
   - Facts。
   - Inference。
   - Unknown / missing。
3. 不把價格上漲當成基本面證明。
4. 不把新聞熱度當成投資價值。
5. 不杜撰 consensus。
6. 不杜撰 valuation。
7. 不杜撰公司 KPI。
8. Current price 必須來自 market provider。
9. 所有重大數值帶來源。
10. 最後列「什麼證據會推翻目前結論」。

### Market idea prompt

要求：

```text
Find current market themes.
For each theme:
- Why now
- source-backed driver
- beneficiary pathways
- exposure proof
- expectations/valuation risk
- false-positive candidates
- research candidates
Do NOT give an automatic buy recommendation.
```

### Company prompt

要求：

```text
Build a public-equity issuer baseline.
Cover:
- business mix
- earnings drivers
- margins
- balance sheet
- cash conversion
- capital allocation
- valuation context
- catalysts
- risks
- evidence gaps
- what would change the view
```

### Portfolio risk prompt

LLM 只解釋由風險引擎算出的 JSON：

```text
Do not recompute authoritative values.
Explain:
- concentration
- correlation
- drawdown
- stop downside
- sector/currency exposure
- risk clusters
- scenario weaknesses
```

---

## 24. Risk Engine（風險計算引擎）

確定性計算。

輸入：

```text
positions
prices
historical prices
sector metadata
currency
active alerts
```

輸出：

```json
{
  "nav": 0,
  "top_position_weight": 0,
  "top3_weight": 0,
  "hhi": 0,
  "sector_weights": {},
  "country_weights": {},
  "currency_weights": {},
  "max_drawdown_1y": 0,
  "volatility_30d": 0,
  "stop_loss_downside_amount": 0,
  "stop_loss_downside_pct_nav": 0,
  "warnings": []
}
```

### Stop downside

對每筆有 stop 的 long position：

```text
max(current_price - stop_price, 0) * quantity
```

總和後除 NAV。

這不是完整 tail risk，只是「目前設定停損點以前的名目風險」。

---

## 25. API endpoints

### LINE

```text
POST /webhooks/line
```

### Auth

```text
POST /auth/liff/verify
POST /auth/logout
GET  /me
```

### Portfolio

```text
GET /portfolios
GET /portfolios/:id/summary
GET /portfolios/:id/positions
GET /portfolios/:id/risk
GET /portfolios/:id/performance
```

### Transactions

```text
POST /transactions/draft
POST /transactions/:draftId/confirm
POST /transactions/:id/void
GET  /transactions
```

### Alerts

```text
POST /alerts/draft
POST /alerts/:draftId/confirm
PATCH /alerts/:id
GET /alerts
```

### Research

```text
POST /research/market
POST /research/company
POST /research/portfolio
GET  /research/runs/:id
```

### Intelligence

```text
GET  /intelligence/market/latest
GET  /intelligence/market/digest
GET  /intelligence/holdings/news
GET  /intelligence/instruments/:instrumentId/news
POST /intelligence/digest/generate
```

### Notification preferences

```text
GET   /notifications/preferences
PATCH /notifications/preferences
GET   /notifications/history
```

### Watchlist

```text
GET    /watchlists
POST   /watchlists/:id/items
DELETE /watchlists/:id/items/:instrumentId
```

---

## 26. Environment variables

`.env.example`：

```text
NODE_ENV=

DATABASE_URL=

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LINE_LOGIN_CHANNEL_ID=
LIFF_ID=

AI_PROVIDER=local
AI_LOCAL_BASE_URL=
AI_LOCAL_MODEL=
AI_RESEARCH_MODEL=

# Optional cloud adapters
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=

FUGLE_API_KEY=

APP_BASE_URL=
LIFF_APP_URL=

SESSION_SECRET=
SAFETY_ID_HASH_SECRET=

NEWS_SCAN_INTERVAL_MINUTES=
MARKET_DIGEST_DEFAULT_HOUR=
MARKET_DIGEST_DEFAULT_MINUTE=

LOG_LEVEL=
```

禁止把任何 secret commit 到 git。

---

## 27. Observability

log 必須有：

- request_id。
- user internal UUID。
- LINE event id。
- workflow。
- provider。
- latency。
- tool calls。
- analysis run id。
- alert rule id。
- alert event id。

不要 log：

- LINE access token。
- AI provider API keys / local auth tokens。
- Fugle key。
- raw session token。
- raw LIFF ID token。

---

## 28. 測試

### Domain（領域核心邏輯） tests

至少：

- 第一次買進。
- 多次不同價格買進。
- 部分賣出。
- 全部賣出。
- 賣超拒絕。
- fee。
- tax。
- void。
- reversal。
- Decimal rounding。
- 多幣別基本案例。

### Alert tests

至少：

- above crossing。
- below crossing。
- 無 crossing 不通知。
- ONCE 不重發。
- CROSSING re-arm。
- cooldown。
- worker restart。
- duplicate quote。
- duplicate LINE push prevention。

### LINE tests

- valid signature。
- invalid signature。
- text event。
- postback。
- transaction confirmation。
- alert confirmation。

### Intelligence tests

至少：

- same article URL dedup。
- similar headline cluster。
- same event from multiple sources only one push。
- low-quality source alone does not trigger HIGH。
- holding relevance higher than unrelated ticker。
- CRITICAL immediate push。
- MEDIUM enters digest instead of immediate push。
- quiet-hours behavior。
- same cluster receives genuinely new information → update allowed。
- stale news rejected。
- missing source timestamp handled safely。
- incorrect ticker/entity mapping does not notify。

### AI tests

建立固定 eval cases：

```text
"今天買台積電100股1250"
"剛剛賣掉一半2330，價格1275"
"2330跌破1200提醒我"
"我的最大部位是多少"
"今天市場在炒什麼"
"分析一下光寶科"
```

檢查：

- intent。
- slots。
- 是否需要確認。
- 是否誤觸 write tool。

---

## 29. Security checklist

- LINE signature verification。
- LIFF token server verification。
- DB ownership checks。
- rate limiting。
- idempotency。
- SQL injection protection。
- strict input validation。
- tool allow-list。
- audit log。
- no secrets in log。
- no secret in browser bundle。
- dependency scanning。
- CSRF protection where relevant。
- secure cookies。
- HTTPS only in production。

---

## 30. Codex 實作順序

### Phase 0 — Repo 與規格

Codex 任務：

1. 建 monorepo。
2. 加 AGENTS.md。
3. README。
4. package scripts。
5. lint / format / test。
6. Docker PostgreSQL。
7. CI。

完成條件：

```text
pnpm install
pnpm lint
pnpm test
pnpm build
```

全部成功。

### Phase 1 — Domain + DB

1. schema。
2. transactions。
3. position calculator。
4. portfolio summary。
5. unit tests。

先不要接 LINE。

### Phase 2 — LINE Bot

1. webhook。
2. signature verify。
3. postback router。
4. Flex message utilities。
5. Rich menu definition。
6. transaction draft / confirmation。

### Phase 3 — Alerts

1. market adapter interface。
2. Fugle provider。
3. active subscription manager。
4. alert evaluator。
5. push notification。
6. dedup。
7. restart recovery。

### Phase 4 — LIFF Dashboard

1. LIFF auth。
2. server verification。
3. portfolio overview。
4. holdings。
5. risk。
6. alerts。

### Phase 5 — Natural Language + AI Gateway

1. deterministic command parser。
2. provider-agnostic AI Gateway。
3. LocalLLMProvider（本地模型供應介面）。
4. MockLLMProvider（測試用模擬模型介面）。
5. router structured output。
6. tool registry。
7. read/write tool separation。
8. market research。
9. company research。
10. optional cloud-provider adapter only after core tests pass。

### Phase 6 — Market intelligence & proactive notifications

1. news source adapters。
2. news normalization。
3. ticker/entity mapping。
4. event clustering。
5. source-quality score。
6. materiality score。
7. portfolio-relevance score。
8. holdings news push。
9. daily market digest。
10. market critical alert。
11. notification preferences。
12. dashboard intelligence modules。

### Phase 7 — Investment research workflows

加入：

- market idea generation。
- company tearsheet。
- portfolio risk explanation。
- thesis tracker。
- valuation workflow。

### Phase 8 — Hardening

1. integration tests。
2. Playwright。
3. worker recovery。
4. rate limit。
5. error UX。
6. data-source outage UX。
7. monitoring。

---

## 31. Codex 每個 Phase 的工作方法

每一階段都用：

```text
PLAN
→ IMPLEMENT
→ UNIT TEST
→ INTEGRATION TEST
→ REVIEW DIFF
→ SECURITY CHECK
→ UPDATE DOCS
→ COMMIT
```

Codex 不應一次要求「把整個產品全部做完」。

每 Phase 都應維持可執行狀態。

---

## 32. Definition of Done

功能完成只有在以下全部成立：

- 有型別。
- 有 validation。
- 有 error handling。
- 有 unit tests。
- 重要路徑有 integration tests。
- 不含 secret。
- DB migration 可重跑。
- API 有 authorization。
- write operation 有 idempotency。
- user-facing error 可理解。
- market data 有 `as_of`。
- AI research 有 sources。
- README 已更新。
- `pnpm lint` pass。
- `pnpm test` pass。
- `pnpm build` pass。

---

## 33. 最初版成功標準

使用者可以在 LINE 完成：

```text
我今天買 2330 100 股 1250
```

系統顯示確認卡。

確認後：

```text
已記錄
2330 / BUY / 100 / 1250
```

接著：

```text
2330 跌破 1180 提醒我
```

確認後建立警示。

當即時行情第一次由 >1180 穿越到 <=1180：

- alert event 只產生一次。
- LINE 主動通知。
- Dashboard 同步顯示 triggered。

然後：

```text
我的投資組合
```

能顯示：

- 市值。
- 成本。
- 損益。
- 持股權重。
- active alerts。

最後：

```text
今天 AI 伺服器族群有什麼值得注意？
```

系統：

- 搜尋最新資訊。
- 列出市場主題。
- 找候選公司。
- 驗證實質曝險。
- 分析基本面與風險。
- 標示資料來源、日期與不確定性。
- 不把熱門直接等同買進。

此外，當：

```text
使用者持有 2330
```

而系統偵測到新的重大公司事件時：

- 先完成來源驗證與事件聚類。
- 判斷該事件與 2330 的直接關聯。
- 評估 materiality 與 portfolio relevance。
- HIGH / CRITICAL 才主動 LINE Push。
- 同一事件不重複推播。
- 使用者可以點擊進入完整公司分析。
- 可選擇把事件加入 Thesis evidence。

使用者點：

```text
市場情報 → 今日市場精華
```

必須在 LINE 首屏看到：

- 5–8 個真正重要的市場事件。
- 熱門產業與實質受益路徑。
- 研究候選，而非直接買進建議。
- 對自己的持股影響。
- 每則資料的 as-of 與來源。

做到這裡，才算完成完整的「投資記錄＋風險＋情報」MVP。


---

## UI/UX implementation dependency

前端與 LINE UX 實作前，Codex 必須先閱讀：

```text
UIUX_AND_NATURAL_LANGUAGE_SPEC.md
```

該文件擁有：

- information architecture
- Rich Menu hierarchy
- Flex card hierarchy
- LIFF dashboard navigation
- command bar
- natural language intent taxonomy
- conversational session behavior
- ambiguity handling
- write confirmation UX
- contextual follow-up
- acceptance scenarios

若工程實作與 UIUX spec 衝突：

1. 資料完整性 / security 規則優先。
2. domain source-of-truth 規則優先。
3. 其餘使用 UIUX spec 的互動設計。


---

## v0.4 UI reference

使用者已提供原始視覺參考截圖。

前端實作時除 `UIUX_AND_NATURAL_LANGUAGE_SPEC.md` 外，必須再讀：

```text
VISUAL_REFERENCE_AUDIT.md
```

UI 重點改為：

```text
dark financial shell
+ freshness utility bar
+ large NAV hierarchy
+ segmented holdings bars
+ contextual inspector
+ mobile bottom-sheet adaptation
```

不得把參考圖直接縮成手機版；必須保留其設計語言，再進行 LIFF mobile 重排。


---

## Future Phase — Mobile App Client（V1 不執行）

只有在 LINE + LIFF 已實際使用並驗證產品價值後才開始。

手機 App 新增：

- native/cross-platform UI
- mobile auth identity provider
- native push provider
- biometrics
- universal/app links
- richer charts

手機 App重用：

- Portfolio API
- Transaction logic
- Alerts
- Intelligence
- Research
- Thesis
- AI Gateway

不得複製 domain business logic 到 App。

## Client capability matrix

| Capability | LINE V1 | LIFF V1 | Mobile Future |
|---|---:|---:|---:|
| 自然語言 | ✅ | ✅ | ✅ |
| 快速交易 draft | ✅ | ✅ | ✅ |
| 交易確認 | ✅ | ✅ | ✅ |
| 停利停損 | ✅ | ✅ | ✅ |
| 價格通知 | ✅ | 顯示歷史 | ✅ native push |
| 持股重大消息 | ✅ push | ✅完整檢視 | ✅ native push |
| 每日市場摘要 | ✅ | ✅ | ✅ |
| Portfolio Dashboard | 精簡 | ✅完整 | ✅完整 |
| 進階圖表 | ❌ | ✅ | ✅ |
| Thesis / Research | 快速入口 | ✅ | ✅ |
| Biometrics（生物辨識驗證） | ❌ | ❌ | ✅ future |
