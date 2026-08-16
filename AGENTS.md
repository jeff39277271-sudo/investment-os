# AGENTS.md — LINE Investment Assistant

## Mission

Build and maintain a reliable personal investment portfolio assistant whose primary user interface is LINE.

The application records transactions, derives portfolio state, monitors user-defined price alerts, provides LIFF dashboards, and uses OpenAI for conversational routing and research.

This is NOT an automated trading system.

---

## Non-negotiable architecture rules

1. `transactions` is the portfolio source of truth.
2. Positions and P/L must be derived by deterministic code.
3. LLM output must never be the authoritative source for:
   - quantities
   - average cost
   - realized P/L
   - unrealized P/L
   - alert threshold evaluation
4. Every mutation initiated through natural language must use:
   - draft
   - review
   - explicit confirmation
   - commit
5. Never place trades.
6. Never add broker order execution without an explicit new product decision.
7. Market price alerts are notification-only.
8. Use Decimal-safe math for money and quantities.
9. Persist data-source `as_of` and source metadata.
10. Current quote data must come from a market-data provider, not web search.
11. Research results must distinguish facts, inference, and missing data.
12. Market-theme candidates are research candidates, not automatic recommendations.
13. Do not fabricate consensus, KPIs, financials, prices, or valuations.
14. Do not log secrets or raw auth tokens.
15. Every user-owned resource must be ownership-checked server-side.

---

## Preferred project shape

Use a TypeScript monorepo:

- `apps/api`
- `apps/worker`
- `apps/dashboard`
- `packages/db`
- `packages/domain`
- `packages/market-data`
- `packages/line-ui`
- `packages/ai-tools`
- `packages/shared`

Prefer a consistent stack throughout the repo.

Before choosing between equivalent libraries, inspect the existing repository and preserve established choices.

---

## Development loop

For each task:

1. Inspect related code and docs.
2. State the implementation plan.
3. Implement the smallest complete vertical slice.
4. Add or update tests.
5. Run lint.
6. Run typecheck.
7. Run tests.
8. Run build.
9. Review the diff for:
   - data integrity
   - auth
   - idempotency
   - money precision
   - failure behavior
10. Update documentation.

Do not leave the repository knowingly broken.

---

## Commands

When package scripts exist, prefer:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For a targeted change, run targeted tests first, then the full suite before marking the task complete.

---

## Database discipline

- Use migrations.
- Never mutate production schema manually.
- Use UUID primary keys unless an existing convention says otherwise.
- Use unique constraints for idempotency keys.
- Do not hard-delete confirmed transactions.
- Corrections should use `VOIDED` or reversal semantics.
- Caches/materialized positions must be rebuildable from transactions.

---

## Transaction rules

A transaction write flow must be:

```text
user input
→ parse
→ draft
→ deterministic validation
→ user confirmation
→ DB commit
→ recalculate portfolio
→ response
```

Validate:

- symbol exists
- side
- quantity > 0
- price > 0
- currency
- trade date
- SELL quantity <= owned quantity for MVP

Never infer missing critical values silently.

---

## Alert rules

Alert evaluation belongs in the worker.

Use crossing logic.

For a `PRICE_BELOW` rule:

```text
previous_price > threshold
current_price <= threshold
```

For a `PRICE_ABOVE` rule:

```text
previous_price < threshold
current_price >= threshold
```

Requirements:

- event deduplication
- idempotent LINE push workflow
- restart recovery
- cooldown
- ONCE and CROSSING modes
- durable alert-event ledger

---

## Market-data architecture

All providers implement a common interface.

Never leak provider-specific payloads into domain logic.

Normalized quote shape should include at least:

```ts
{
  instrumentId,
  symbol,
  price,
  currency,
  market,
  exchange,
  timestamp,
  source
}
```

Initial Taiwan implementation:

- Fugle real-time WebSocket / REST
- TWSE OpenAPI for public market/company data

US market support should be implemented behind the same interface.

---

## LINE rules

Webhook:

- verify signature using raw body
- reject invalid signatures
- make event processing idempotent

Mutations:

- use postback IDs tied to server-side draft IDs
- never trust values embedded in client-visible labels as the source of truth

Rich Menu should route by stable action codes.

Flex Message generation should be centralized in `packages/line-ui`.

---

## LIFF rules

Do not trust user profile fields sent from the browser.

Flow:

```text
LIFF obtains raw ID token
→ client sends token to API
→ API verifies with LINE
→ use verified `sub`
→ establish application session
```

Never expose server secrets in the dashboard bundle.

---

## OpenAI rules

Use the Responses API.

The AI layer can:

- classify intent
- extract slots
- answer natural-language questions
- call read tools
- search current public information
- summarize deterministic risk output
- run company/market research

The AI layer cannot:

- become portfolio source of truth
- evaluate price-trigger state
- commit writes without explicit confirmation
- invent missing market data

Use structured outputs for routing and extraction.

Separate tools into:

- read-only
- draft mutation
- confirmed mutation

Give the model only the smallest necessary tool allow-list for the current flow.

---

## Investment research routing

### Public Equity Investing is the main investor workflow

Use these conceptual workflows:

- `idea_generation`
- `company_tearsheet`
- `portfolio_risk`
- `thesis_tracker`

### Investment Banking is supplemental

Use banker-style logic only for:

- capital structure
- EV-to-equity bridge
- peer normalization
- comps
- DCF support
- financing / M&A equity-value impact

Do not let an IB workflow become the final owner of a personal public-equity investment decision.

---

## Research output contract

Every material research answer must include:

- as-of date/time
- key facts
- interpretation
- uncertainties / missing data
- risks
- what could invalidate the current view
- sources or source metadata

For market ideas:

- Why now
- exposure proof
- expectations risk
- first rejection
- next research step

Do not label a theme candidate as a recommendation merely because it is popular or has recently appreciated.

---

## Security

Treat these as blocking issues:

- missing LINE signature verification
- missing auth ownership checks
- secret in source code
- raw token in logs
- SQL injection risk
- write route without validation
- write route without idempotency
- alert push without deduplication
- client-controlled user ID
- current-price logic based on web search

---

## Testing expectations

New domain behavior requires tests.

High-priority regression areas:

- weighted average cost
- realized P/L
- partial sell
- oversell rejection
- transaction void/reversal
- alert crossing
- alert dedup
- worker restart
- invalid LINE signature
- LIFF identity spoofing
- AI attempting unauthorized write
- stale market data

---

## Definition of done

Before completing a task, report:

1. What changed.
2. Files changed.
3. Tests added/updated.
4. Commands run.
5. Results.
6. Remaining risks or intentionally deferred items.

A task is not complete if lint, typecheck, tests, or build fail unless the failure is explicitly unrelated and documented.


---

## Proactive intelligence and notification rules

There are two distinct proactive systems:

1. price alert engine
2. market/news intelligence engine

Never merge their source-of-truth logic.

### Holdings/watchlist news

The application should proactively identify potentially material developments involving:

- current holdings
- watchlist securities

A news item must not be pushed merely because the ticker is mentioned.

Before push notification, determine:

- entity/ticker match confidence
- event type
- source quality
- materiality
- portfolio relevance
- novelty
- whether the event is already part of an existing cluster

### Notification priority

Use:

- CRITICAL
- HIGH
- MEDIUM
- LOW

Behavior:

- CRITICAL: immediate push, subject to explicit user notification preferences.
- HIGH: prompt push.
- MEDIUM: digest by default.
- LOW: store only.

Do not hard-code thresholds inside LLM prompts. Thresholds and weights belong in configuration/domain code.

### News deduplication

Multiple reports of the same event should map to a durable `news_cluster`.

A cluster should normally generate at most one initial proactive notification per user.

Only send a follow-up when new information materially changes the event.

### Market digest

The daily digest should optimize for decision relevance, not article count.

It should answer:

- what matters now
- why the market cares
- which sectors are exposed
- which companies have actual exposure evidence
- what affects the user's holdings
- what to monitor next

Market popularity is not investment merit.

### Source discipline

Prefer, where available:

1. issuer filings / IR
2. exchanges, regulators, government, central banks
3. high-quality financial news
4. market / industry data
5. other public sources

Social chatter may help identify attention but cannot be the sole evidence for a fundamental claim.

Every material event stored or shown should retain:

- source
- published_at
- retrieved_at
- as_of where applicable
- event cluster id
- affected instruments
- confidence

### Quiet hours and notification settings

Respect per-user settings.

Do not silently bypass quiet hours except where the user's configured policy explicitly allows a priority to do so.

### AI role in intelligence

The model may:

- classify
- summarize
- explain
- map possible impact
- propose thesis evidence
- cluster semantically

The model must not be solely responsible for:

- deduplication
- scheduler state
- notification delivery state
- user notification preferences
- current holdings
- deciding whether a push was already sent

Those are deterministic application concerns.


---

## UI/UX and natural-language interaction

Before implementing LINE interaction, LIFF UI, intent routing, or conversational state, read:

```text
UIUX_AND_NATURAL_LANGUAGE_SPEC.md
```

Natural language is a first-class UI surface.

Every supported action should have one domain workflow regardless of whether it was triggered by:

- Rich Menu
- Flex Message postback
- LIFF UI
- natural language

Do not create separate business logic for menu and chat paths.

### Natural-language mutation safety

Classify commands as:

- READ
- RESEARCH
- MUTATION_DRAFT
- CONFIRMATION

All data mutations from natural language require draft + explicit confirmation.

A confirmation must reference an active server-side draft.

Never infer a write from statements such as:

- "I am thinking about buying..."
- "Would 1250 be a good price?"
- "If it falls to 100 I might sell..."

These are research/planning statements, not transaction instructions.

### Contextual follow-up

Preserve structured short-lived conversation context such as:

- active instrument
- active portfolio
- active draft
- last research run

Do not rely on an unbounded raw chat transcript as application state.

### Ambiguity

If a write command cannot be resolved uniquely, ask for the missing field and do not mutate data.

For reads/research, reasonable context resolution is allowed when confidence is high and no side effect occurs.

### UI style

Use a restrained, crisp, finance-professional design.

Prioritize:

- information hierarchy
- large decision-useful numbers
- clear data freshness
- semantic state
- compact cards
- mobile legibility

Avoid decorative gamification and profit-celebration patterns.


---

## Visual reference implementation

The user has supplied the actual visual reference.

Before implementing the dashboard or LINE visual system, read:

```text
VISUAL_REFERENCE_AUDIT.md
```

Preserve these characteristics:

- dark financial shell
- thin-border hierarchy
- restrained radii
- large portfolio-value hierarchy
- tabular data typography
- semantic-only red/green
- segmented holding bars
- freshness-first utility strip
- contextual inspector

Do not literally shrink the desktop reference into mobile.

Use:

- floating inspector on desktop
- bottom sheet on LIFF/mobile

Do not allow visual fidelity to weaken:

- stale-data disclosure
- transaction confirmation
- alert confirmation
- accessibility
- ownership/auth checks
- responsive usability


---

## Multi-client architecture rules

V1 clients:
- LINE
- LIFF

Future:
- Mobile app

Treat every client as an adapter. Business logic belongs in shared application/domain packages.

Never:
- calculate portfolio state in a LINE webhook
- place risk logic in React components
- make direct DB writes from LIFF
- duplicate transaction logic in a future mobile app
- use `line_user_id` as the product's primary user identity

Use internal `user_id` + provider identity mapping.

### Notification channels
Domain creates notification events; channel providers deliver them.

V1:
- LineNotificationProvider

Future:
- MobilePushProvider

### AI providers
AI must be provider-agnostic.

Required:
- deterministic parser
- `LLMProvider` interface
- MockLLMProvider for tests

OpenAI API must not be a requirement for core portfolio functionality.


---

## Chinese annotation for technical terms

Reader-facing documentation and UI specifications must annotate important technical English terms in Traditional Chinese on first use.

Format:

```text
English Term（中文註解）
```

Examples:

```text
Domain Layer（領域核心層）
Transaction Ledger（交易流水帳／交易唯一事實來源）
Idempotency（冪等性／避免重複執行）
Market Intelligence（市場情報）
AI Gateway（AI 統一介接層）
```

Do not translate executable identifiers such as:
- class names
- interface names
- enum values
- API routes
- database columns
- environment variable names

Use `GLOSSARY_ZH_TW.md` as the canonical terminology reference.
