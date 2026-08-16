
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

# UI/UX + Natural Language Interaction Spec

版本：v0.6  
適用：Investment OS；V1 = LINE + LIFF（LINE Front-end Framework／LINE 內嵌網頁框架），Future = Mobile Client（使用端／客戶端）

> 參考方向：使用者指定的 X 貼文。可確認的公開描述為「finance company / details and crisp」風格。由於原始圖片目前無法可靠載入，本文件先固定資訊架構、互動邏輯與可推導的視覺原則；若日後提供原圖截圖，可再進行像素級視覺校正。

---

# 1. 核心 UX 原則

產品不是「聊天機器人加幾個按鈕」，而是：

```text
Conversation-first, multi-client investment operating system
```

V1：
- LINE = 快速自然語言 + 主動通知
- LIFF = 深度 Dashboard + Research

Future：
- Mobile App = 新增深度 Client
- LINE = 繼續保留快速入口與 companion notification channel

使用者可以用兩種完全等價的方式操作：

```text
A. 點選單
B. 直接說話
```

兩者最後必須 route 到同一個 domain workflow。

例如：

```text
Rich Menu → 交易紀錄 → 買進
```

與：

```text
「今天買台積電 100 股 1250」
```

最後都進入：

```text
transaction.create_draft
```

---

# 2. 視覺方向

## 2.1 Design characteristics

第一版採以下方向：

- financial-professional。
- crisp。
- restrained。
- information-first。
- large-number-first。
- soft card hierarchy。
- minimal decoration。
- semantic color only where meaningful。
- mobile-first。
- dense enough for investment information，但避免 Bloomberg-terminal 式過度密集。

避免：

- 過多漸層。
- 裝飾性動畫。
- 過量 icon。
- 每張卡都不同顏色。
- 用紅綠以外的過多「情緒色」。
- 大量陰影。
- 過度圓潤、玩具感。
- 把投資產品做成遊戲化介面。

---

# 3. Design tokens

以下為第一版工程 token，不宣稱與參考圖像素一致。

## Color roles

不要把品牌色散佈到每一個元件。

```text
surface.page
surface.card
surface.elevated
border.subtle
text.primary
text.secondary
text.muted

semantic.positive
semantic.negative
semantic.warning
semantic.info
semantic.critical
```

原則：

- 預設頁面以中性背景＋高對比字體。
- 上漲 / 正向才使用 positive。
- 下跌 / 負向才使用 negative。
- CRITICAL 才使用強烈 alert 色。
- 市值、成本、一般資訊不要因「重要」就亂上色。

## Radius

```text
small: 8
medium: 12
large: 16
```

Finance dashboard 主卡建議 medium。

## Spacing

使用 4pt / 8pt 基準：

```text
4 / 8 / 12 / 16 / 24 / 32
```

## Typography hierarchy

```text
Display number
Page title
Section title
Card title
Body
Caption
Metadata
```

數值與百分比使用 tabular numerals。

---

# 4. LINE 主畫面

Rich Menu（LINE 圖文選單） 不承擔所有資訊，只負責最高頻導航。

建議：

```text
┌───────────────────────────────┐
│  投資組合  │  市場情報       │
├────────────┼──────────────────┤
│  交易      │  個股研究       │
├────────────┼──────────────────┤
│  警示中心  │  開啟儀表板     │
└───────────────────────────────┘
```

Rich Menu 必須：

- 六個主入口。
- 文案短。
- icon 線性、一致。
- 避免把所有子功能塞在圖片上。
- 點擊後用 Flex Message（LINE 彈性訊息卡片） 顯示子選單。

---

# 5. 對話首頁 / Welcome state

當使用者第一次開啟或輸入「選單」：

```text
投資助手

今天想做什麼？

[查看投資組合]
[市場最新情報]
[記錄交易]
[分析一家公司]

也可以直接輸入：
「今天買台積電 100 股 1250」
「我的投資組合風險」
「今天 AI 伺服器在漲什麼？」
```

目標：

- 使用者第一次就知道不必背指令。
- 明確告知「可以直接說」。

---

# 6. Portfolio（投資組合） summary card

LINE Flex 首屏應控制資訊量。

```text
我的投資組合
資料時間 14:32

NT$ 1,284,500
今日     +1.24%
未實現   +8.7%

最大部位
TSMC  28.4%

風險
Top 3        61%
停損前風險   4.8% NAV

[持股明細] [風險分析]
[重大消息] [完整儀表板]
```

原則：

- 第一視線：NAV（淨資產價值／投資組合總值）。
- 第二視線：P/L（損益）。
- 第三視線：集中風險。
- 不在 LINE 卡片塞完整 20 檔持股。

---

# 7. Holding card

```text
2330
台積電

1,250
+1.8%

持有        100 股
平均成本    1,180
市值        125,000
未實現      +5.9%
權重        18.2%

停損 1,120
停利 1,360

[公司分析]
[最新消息]
[設定警示]
```

---

# 8. Market intelligence card

首頁不是「新聞列表」，而是 intelligence brief。

```text
市場精華
23:00 更新

01
AI 資本支出預期再升溫
影響：半導體 / 伺服器 / 電源

Why it matters
主要 CSP 資本支出預期...

Your portfolio
台積電：正相關
光寶科：可能受益

[看 3 分鐘版]
```

每次 LINE 首屏最多：

```text
5–8 themes
```

---

# 9. Holdings news card

```text
持股重大消息

HIGH
2330 台積電

事件
...

投資影響
營收：+
毛利率：?
估值：中性
Thesis：尚未足以改變

你的權重
18.2%

[完整分析]
[加入 Thesis]
[稍後提醒]
```

必須使用「資訊影響」而不是「建議買賣」作為首層 framing。

---

# 10. LIFF Dashboard Information Architecture

底部 navigation：

```text
Overview
Portfolio
Intelligence
Research
More
```

## Overview

### Hero

```text
Good evening
Portfolio value

NT$ 1,284,500
+1.24% today
```

### Quick command

Dashboard 上方或 hero 下方：

```text
Ask your portfolio...
```

支援：

- tap → 開輸入。
- recent commands。
- suggestion chips。

例如：

```text
[今天風險]
[持股重大消息]
[市場摘要]
[分析 2330]
```

### Sections

1. Portfolio performance。
2. Top holdings。
3. Risk snapshot。
4. Important holdings news。
5. Market intelligence。
6. Next events。

---

# 11. Portfolio screen

Header：

```text
Portfolio
As of 14:32
```

Segment：

```text
Holdings | Allocation | Performance | Risk
```

## Holdings

Table/card：

```text
Ticker
Market value
Weight
P/L
Alert status
```

點入 holding → security detail。

---

# 12. Security detail

頁面順序：

```text
Ticker / company
Price / daily move

My position
Investment status
Latest material news
Thesis
Financial health
Valuation context
Catalysts
Risks
Alerts
```

避免一進去先顯示長篇 AI 文字。

---

# 13. Intelligence screen

Tabs：

```text
For You
Market
Holdings
Watchlist
```

## For You

依：

```text
portfolio relevance × materiality × novelty
```

排序。

卡片顯示：

```text
topic
priority
one-sentence conclusion
affected holdings
timestamp
```

---

# 14. Command（操作指令） palette / natural-language bar

這是整個 UI 最重要的新元件之一。

LIFF：

```text
┌──────────────────────────────────┐
│ Ask about your portfolio...   ↑ │
└──────────────────────────────────┘
```

LINE：

直接使用原生聊天輸入框。

自然語言是第一級入口，不是 fallback。

---

# 15. Natural Language Command Architecture

## 15.1 Four command classes

### READ

可立即執行。

例：

```text
「我的投資組合」
「台積電現在多少」
「我目前台積電賺多少」
「我最大的風險是什麼」
```

### RESEARCH

可立即執行，但必須取得最新資料。

例：

```text
「今天市場在炒什麼」
「分析一下台光電」
「AI server 最近有什麼重要消息」
```

### MUTATION_DRAFT

先建立 draft，不得直接 commit。

例：

```text
「今天買台積電100股1250」
「把停損改成1180」
「把光寶科加入觀察名單」
```

### CONFIRMATION

只有明確確認後 commit。

例：

```text
「確認」
「對，記錄」
「執行」
```

但 confirmation 必須綁定：

```text
active_draft_id
```

不能單靠「確認」兩個字猜要執行哪件事。

---

# 16. Supported natural-language intents

第一版至少支援：

```text
PORTFOLIO_SUMMARY
PORTFOLIO_POSITIONS
PORTFOLIO_RISK
PORTFOLIO_PNL

TRANSACTION_BUY
TRANSACTION_SELL
TRANSACTION_HISTORY
TRANSACTION_VOID

ALERT_CREATE_STOP_LOSS
ALERT_CREATE_TAKE_PROFIT
ALERT_LIST
ALERT_DISABLE

HOLDING_NEWS
MARKET_DIGEST
MARKET_THEME
MARKET_EVENT

COMPANY_QUICK_ANALYSIS
COMPANY_DEEP_ANALYSIS
COMPANY_VALUATION
COMPANY_NEWS

WATCHLIST_ADD
WATCHLIST_REMOVE
WATCHLIST_LIST

THESIS_VIEW
THESIS_ADD_EVIDENCE

HELP
MENU
CANCEL
CONFIRM
```

---

# 17. Natural-language examples

## Transaction

```text
今天買台積電100股1250
```

```text
剛剛1255賣掉台積電50股
```

```text
我今天買了10股PLTR，價格是180美元
```

## Alert

```text
台積電跌破1180提醒我
```

```text
光寶科漲到200通知我
```

```text
幫我把2330停損改成成本的-8%
```

## Portfolio

```text
我現在最集中的股票是哪一檔
```

```text
如果所有停損都被打到，我大概會損失多少
```

```text
我的半導體曝險多少
```

## Research

```text
今天市場最重要的5件事
```

```text
市場最近為什麼一直討論PCB
```

```text
幫我找AI伺服器值得進一步研究的台股
```

```text
台光電現在基本面有變差嗎
```

## Contextual follow-up

```text
User:
分析台積電

Assistant:
...分析...

User:
那估值呢？
```

系統必須理解：

```text
security = 2330
intent = COMPANY_VALUATION
```

不得要求重新輸入 ticker。

---

# 18. Conversational state

建立：

```text
conversation_sessions
```

至少：

```text
id
user_id
active_intent
active_instrument_id
active_portfolio_id
active_draft_id
last_research_run_id
context_json
expires_at
updated_at
```

不要把完整長對話永久塞進 prompt。

只保存工作流需要的結構化 context。

---

# 19. Intent（使用者意圖） router

輸入：

```json
{
  "message": "那停損改成1180",
  "session": {
    "active_instrument": "2330"
  }
}
```

輸出：

```json
{
  "intent": "ALERT_CREATE_STOP_LOSS",
  "confidence": 0.97,
  "resolved_entities": {
    "symbol": "2330",
    "threshold": 1180
  },
  "requires_write": true,
  "requires_confirmation": true,
  "missing_fields": []
}
```

---

# 20. Ambiguity handling

不能因 AI「大概知道」就操作。

例：

```text
「幫我賣掉一半」
```

如果 session 中只有一檔 active holding：

```text
可以建立 draft
```

如果可能指多檔：

```text
你要賣哪一檔？
[2330 台積電]
[2308 台達電]
...
```

---

# 21. Confirmation（確認執行） UX

寫入動作統一使用 Review Card。

```text
確認交易

BUY
2330 台積電

100 股
NT$1,250
2026/08/15

預估金額
NT$125,000
未含 / 已含費用標示

[確認]
[修改]
[取消]
```

禁止：

```text
User: 今天買台積電100股1250
Assistant: 已記錄
```

---

# 22. Compound commands

P1 支援：

```text
「幫我記錄今天買2330 100股1250，然後跌破1180提醒我」
```

拆成：

```text
transaction draft
+
alert draft
```

顯示一張 combined review：

```text
即將執行 2 個動作

1. 記錄買進
2. 建立停損

[全部確認]
[逐項修改]
[取消]
```

底層仍分開 commit，需 transactional / compensating behavior。

---

# 23. Natural language security rules

模型不得：

- 以新聞中提到的價格建立 transaction。
- 猜成交價。
- 猜數量。
- 猜 ticker 對應。
- 直接 commit。
- 對 ambiguous write 自行選標的。
- 將「我考慮買」解析成 BUY transaction。
- 將「如果跌到100我想賣」直接建立 sell。
- 把研究提問當成交易命令。

例：

```text
「台積電1250可以買嗎」
```

必須：

```text
RESEARCH / INVESTMENT_QUESTION
```

不是：

```text
TRANSACTION_BUY
```

---

# 24. Suggested prompts / chips

自然語言功能不應要求使用者學指令。

系統依畫面提供 contextual suggestions。

Portfolio：

```text
[我的最大風險？]
[今天損益？]
[重大消息]
```

Stock：

```text
[這家公司體質？]
[估值？]
[最新消息？]
[我的損益？]
```

Market：

```text
[今天最重要5件事]
[熱門族群]
[我的持股影響]
```

---

# 25. Motion

僅使用功能性動畫：

- card expand。
- number update。
- navigation transition。
- command sending。
- loading skeleton。

避免：

- confetti。
- gamified profit animation。
- 為獲利使用過度慶祝效果。

投資決策介面應維持中性。

---

# 26. Empty states

例如沒有持股：

```text
目前還沒有投資紀錄。

你可以直接說：
「今天買台積電100股1250」

或

[記錄第一筆交易]
```

沒有重大消息：

```text
目前沒有新的重大持股事件。
最近一次掃描：22:45
```

---

# 27. Error states

Market provider down：

```text
即時行情暫時無法取得。
最後有效價格：14:28
資料目前已過期 7 分鐘。

[稍後重試]
```

禁止用 stale price 冒充 current price。

---

# 28. Accessibility

- 文字與背景對比合格。
- 不只靠紅 / 綠表達。
- P/L 同時顯示 `+/-`。
- 字級避免過小。
- icon 有文字 / aria label。
- chart 有 textual summary。
- touch target 至少符合 mobile usability。

---

# 29. Responsive（響應式版面） design

優先順序：

```text
LINE Flex
↓
LIFF mobile
↓
tablet
↓
desktop
```

Desktop dashboard 可增加密度，但不能重新發明資訊架構。

---

# 30. UI implementation guidance

Dashboard 建議建立：

```text
components/
  AppShell
  PortfolioHero
  MetricCard
  HoldingRow
  RiskCard
  IntelligenceCard
  NewsImpactCard
  CommandBar
  SuggestionChips
  ConfirmActionCard
  SourceBadge
  AsOfBadge
  EmptyState
  StaleDataBanner
```

所有 finance number formatting 集中處理。

所有：

```text
price
currency
percentage
timestamp
data freshness
```

不得由個別 component 自己拼字串。

---

# 31. Acceptance scenarios

## Scenario A — menu

```text
Rich Menu
→ 投資組合
→ Flex submenu
→ 風險
→ risk workflow
```

## Scenario B — natural language read

```text
「我現在最大的風險？」
→ PORTFOLIO_RISK
→ deterministic calculation
→ AI explanation
```

## Scenario C — natural language write

```text
「2330跌破1180提醒我」
→ resolve 2330
→ create alert draft
→ review card
→ user confirms
→ save alert
```

## Scenario D — contextual follow-up

```text
「分析2330」
→ company analysis

「那最近有什麼重大消息」
→ COMPANY_NEWS security=2330
```

## Scenario E — ambiguous command

```text
「賣一半」
→ no unique active security
→ clarification
→ no mutation
```

## Scenario F — intent distinction

```text
「台積電1250適合買嗎」
→ investment research
→ NOT transaction draft
```

---

# 32. UI reference fidelity note

在沒有原始參考圖片可直接檢視之前：

可以先落實：

- hierarchy
- density
- card logic
- interaction
- crisp finance visual language

不可宣稱已精確複製：

- exact color palette
- exact typography
- exact radius
- exact spacing
- exact component geometry

若取得參考圖截圖，再做：

```text
visual audit
→ token adjustment
→ component restyle
→ screenshot comparison
→ responsive QA
```


---

# 33. High-fidelity visual direction from provided reference

原始參考圖已取得，因此 UI 不再只依「crisp finance」文字描述推導。

完整拆解請讀：

```text
VISUAL_REFERENCE_AUDIT.md
```

以下為不可忽略的視覺原則：

1. 深黑 canvas + 深灰資料 panel。
2. 以 thin border 而不是陰影做層級。
3. Portfolio NAV / total value 是第一視覺焦點。
4. 使用等寬感或 tabular numerals 顯示價格、金額、報酬與時間。
5. 綠 / 紅只代表金融正負語義。
6. Holdings 允許使用 segmented data bars。
7. Desktop 點擊持股使用 contextual floating inspector。
8. LIFF mobile 對應為 bottom sheet，而非縮小浮窗。
9. 最上方保留 Data Freshness（資料新鮮度／更新時效） utility strip。
10. 內部 panel 不要全部套大圓角；外殼可圓、資料區塊偏方正。
11. 自然語言回答在 Dashboard 裡優先渲染成 compact result inspector，而不是大量聊天泡泡。
12. 所有視覺模仿都必須讓位給：
    - data integrity
    - readability
    - mobile usability
    - confirmation safety

推薦 token 與 component mapping 以 `VISUAL_REFERENCE_AUDIT.md` 為準。


---

# 34. Multi-client UX contract

## LINE
適合自然語言、快速確認、重大消息、價格警示、每日摘要與 LIFF deep link。

## LIFF
V1 主控制台：Portfolio、Risk、Intelligence、Research、Thesis（投資論點）、Command Bar（自然語言指令輸入列）。

## Future Mobile App
不是取代 LINE，而是增加原生導航、原生 Push、biometrics、更完整圖表與更長時間的研究工作流。

### Deep-link strategy

V1：

```text
LINE notification
→ LIFF deep link
→ exact ticker / event / research screen
```

Future：

```text
LINE notification
→ universal link
├─ App installed → mobile screen
└─ no app → LIFF fallback
```

各 Client 必須維持相同的資料、狀態與決策結果。
