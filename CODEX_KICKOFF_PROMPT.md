# Codex Kickoff Prompt

請讀取根目錄的 `AGENTS.md`、`LINE投資組合助手_Codex實作規格.md`、`MULTI_CLIENT_ARCHITECTURE.md`，把它們視為本專案的主要規格與工程限制。

現在只執行 **Phase 0 + Phase 1**，不要一次完成全部產品。

目標：
1. 建立 TypeScript monorepo。
2. 建立 PostgreSQL 本機開發環境。
3. 建立資料庫 schema 與 migrations。
4. 完成 transaction domain。
5. 完成 weighted-average cost position calculator。
6. 完成 realized / unrealized P&L domain calculator。
7. 建立 portfolio summary service。
8. 完成必要 unit tests。
9. README 提供本機執行方式。
10. 加上 `.env.example`，不得寫入任何真實 secret。

要求：
- 先提出 implementation plan，再開始修改。
- transaction ledger 是 source of truth。
- 使用 Decimal-safe arithmetic。
- 不做 LINE、不做 LIFF UI、不做 AI provider、不做 Fugle；這些等後續 Phase。
- 不實作自動下單。
- 所有核心 domain logic 必須有 tests。
- 最後執行 lint、typecheck、test、build。
- 若任何命令失敗，先修正再完成。
- 最後列出 changed files、測試結果與下一階段建議。

Phase 1 驗收案例至少包含：
- first buy
- multiple buys at different prices
- partial sell
- full sell
- oversell rejection
- fees
- taxes
- void / reversal
- decimal precision


## Future compatibility requirement

Although this task only implements Phase 0 + Phase 1, do not design the schema or domain in a way that blocks later addition of:

- hierarchical LINE menus
- holdings/watchlist news monitoring
- market intelligence digests
- event clustering and deduplicated proactive notifications
- per-user notification preferences
- LIFF market-intelligence dashboard modules

Do not implement those features yet; only avoid architectural dead ends.


## UI / conversational compatibility

Do not implement the UI yet in Phase 0 + 1, but domain APIs must remain usable by both:

- menu/postback actions
- natural-language tool calls

Do not embed LINE-specific presentation concerns inside portfolio domain calculations.

Future Codex phases must read `UIUX_AND_NATURAL_LANGUAGE_SPEC.md` before implementing LINE or LIFF surfaces.


## Visual reference note

A high-fidelity UI reference is now available in `VISUAL_REFERENCE_AUDIT.md`.

Phase 0 + 1 still should not implement UI, but do not introduce presentation-specific domain coupling that would prevent the later reference-inspired dashboard.


## Multi-client architecture acceptance

Phase 0 + 1 必須：
- domain 不 import LINE / LIFF / Next.js。
- `users` 不以 `line_user_id` 作產品 identity。
- 預留 `user_identities`。
- application services 可被任一 client 呼叫。
- transaction source 可識別 LINE / LIFF / future mobile，但 source 不影響核心計算。
- AI 不得是 Phase 1 必要依賴。
- `clients/mobile` 只做 contract placeholder，不實作手機 App。


## 中文專有名詞規範

開始工作前也請讀取 `GLOSSARY_ZH_TW.md`。

文件、README、架構說明與使用者可見文案中的重要英文專有名詞，第一次出現時使用：

```text
English Term（中文註解）
```

程式碼 identifier 不翻譯。
