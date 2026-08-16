
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

# Multi-Client Architecture

版本：v0.6

## Product decision

V1：

```text
LINE + LIFF + Shared Backend
```

未來：

```text
Mobile App + LINE Companion + Same Backend
```

## Client（使用端／客戶端） responsibilities

### LINE
- 自然語言快速操作
- Rich Menu（LINE 圖文選單） / Flex
- 價格警示
- 持股重大消息
- 市場摘要
- LIFF（LINE Front-end Framework／LINE 內嵌網頁框架） deep links

### LIFF
- Portfolio（投資組合） Dashboard
- Risk
- Intelligence
- Research
- Thesis（投資論點）
- Command（操作指令） Bar（自然語言指令輸入列）
- 深度分析

### Future Mobile App
- 原生 UI
- 原生 Push
- Biometrics（生物辨識驗證）
- 更完整圖表
- Universal links

## Dependency rule

```text
client → application → domain
```

禁止：

```text
domain → LINE
domain → React
domain → mobile SDK
```

## Identity

```text
users
└─ user_identities
   ├─ LINE
   └─ future MOBILE_AUTH
```

Portfolio ownership 永遠綁 internal `user_id`。

## Commands

不同入口共用同一 application command：

```text
LINE postback ─┐
LIFF button ───┼→ CreateAlertDraftCommand
Natural text ──┘
```

## Notifications

```text
Domain NotificationEvent
↓
NotificationDispatcher
├─ LineNotificationProvider
└─ MobilePushProvider (future)
```

Channel 不負責 materiality、dedup 或 business rules。

## AI

```text
Command Router
├─ deterministic parser
└─ AI Gateway
   ├─ LocalLLMProvider
   ├─ MockLLMProvider
   └─ optional CloudLLMProvider
```

核心產品必須能在沒有雲端 AI API 時維持：
- transaction ledger
- portfolio calculations
- price alerts
- menus
- deterministic commands
- dashboard read APIs

## Deep links

V1：

```text
LINE push → LIFF exact screen
```

Future：

```text
LINE push → universal link
├─ App → native screen
└─ fallback → LIFF
```

## Mobile decision gate

只有在 LINE + LIFF 已證明以下需求後才開始手機 App：
- LIFF 每天高頻開啟
- WebView 明顯限制圖表或研究
- 原生 Push 有明確價值
- biometric security 有需求
- 產品行為已穩定，值得維護第二個完整 UI client
