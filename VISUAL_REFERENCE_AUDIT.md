# Visual Reference Audit

版本：v0.4  
參考圖：使用者提供的 finance dashboard 截圖

## 1. 可直接觀察到的設計語言

這張參考圖不是一般「圓角卡片拼貼」式 fintech UI，而是更接近：

- dark editorial finance dashboard
- desktop terminal aesthetic
- crisp data hierarchy
- restrained semantic color
- layered panels
- floating detail inspector
- large-number-first
- thin-border component system
- muted photographic backdrop

核心視覺特色：

1. **黑色主殼層**
   - 頁面主背景接近純黑。
   - 真正的資料介面位於更深色、低對比的 panel 中。
   - 依賴明度差與 1px border 分層，而不是大量陰影。

2. **大區塊不過度圓角**
   - 外層展示框有較大圓角。
   - 內部 dashboard 區塊大多接近直角或極小圓角。
   - 這讓介面看起來更像專業金融 terminal，而不是消費型 app。

3. **資料優先的 typography**
   - `Total Value` 是低調的小標。
   - `$392,763.80` 是視覺核心。
   - 數字使用等寬或近等寬字型感。
   - secondary metadata 明顯降低對比。

4. **綠 / 紅只用於金融語義**
   - 綠色：正報酬、上漲、正向數據。
   - 紅色：負報酬、下跌、負向數據。
   - 其他 UI 幾乎保持黑、灰、白。

5. **Segmented data bars**
   - 持股列表右側不是一般 progress bar。
   - 使用一格一格的 segmented bar。
   - 可同時傳達：
     - allocation
     - gain/loss intensity
     - risk budget
     - alert distance
   - 這個語彙很適合投資組合產品。

6. **Floating inspector**
   - 點擊資產後出現浮動 detail panel。
   - Inspector 疊在主 dashboard 上，不跳離情境。
   - 顯示：
     - ticker / asset
     - price
     - % move
     - sparkline
     - volume
     - market cap
     - low / high
   - 很適合改造成 LINE 投資助手的：
     - 持股詳情
     - 重大消息影響
     - 快速分析
     - 警示設定

7. **Utility bar**
   - 最上方不是傳統 navbar。
   - 顯示「資料幾秒前更新」與少量動作。
   - 這對投資產品非常適合，因為 freshness 是資訊可信度的一部分。

8. **Editorial backdrop**
   - Dashboard 外部有天空 / 景物照片。
   - 背景不是資訊本身，只負責營造質感。
   - 資料仍完全放在高對比深色層上。

---

## 2. 對本專案的直接轉譯

不要複製：

- `Connect Wallet`
- `Refer Friends`
- crypto-specific iconography
- crypto market fields

要保留設計方法，並替換成投資組合語義。

### Utility bar

參考圖：

```text
Data updated 14 SEC AGO   Refer Friends   Connect Wallet
```

改為：

```text
DATA UPDATED 14 SEC AGO   新增交易   設定警示
```

或：

```text
MARKET OPEN · UPDATED 14 SEC AGO   市場摘要   新增交易
```

---

## 3. Dashboard hero

參考圖核心：

```text
Total Value
$392,763.80
```

本專案：

```text
TOTAL PORTFOLIO VALUE
NT$ 1,284,500

+1.24% TODAY
+8.70% UNREALIZED
```

規則：

- Portfolio（投資組合） NAV（淨資產價值／投資組合總值） / total value 是最大文字。
- 今日報酬與未實現報酬次之。
- 不在 hero 同時放過多風險指標。

---

## 4. Holdings rail

改成：

```text
2330  台積電                  +8.7%
████████████████░░░░░         28.4%

2308  台達電                  +4.1%
███████████░░░░░░░░░         18.7%

2382  廣達                    -2.3%
████████░░░░░░░░░░░░         13.9%
```

Segmented bar 的主要語義建議：

- 長度 = portfolio weight。
- 顏色 = P/L（損益） direction。
- secondary marker = stop-loss distance（可選）。

不要讓 bar 同時編碼超過兩種資訊。

---

## 5. Portfolio mini chart

左側圖表應保留參考圖的簡潔感。

Tabs：

```text
VALUE | RETURN | DRAWDOWN
```

Period：

```text
1M | 3M | YTD | 1Y | ALL
```

預設：

```text
VALUE + 1Y
```

圖表：

- 一條主線。
- 不預設 grid-heavy。
- hover / tap 才顯示精確值。
- LINE Flex 不放互動圖，僅 LIFF（LINE Front-end Framework／LINE 內嵌網頁框架）。

---

## 6. Floating holding inspector

點擊 holding：

```text
┌─────────────────────────────────┐
│ 2330  台積電      1,250  +1.8% │
│                                 │
│        ───── sparkline ─────    │
│                                 │
│ 市值                  125,000   │
│ 平均成本                1,180   │
│ 未實現損益              +5.9%   │
│ 投資組合權重             18.2%  │
│ 停損                    1,120   │
│ 停利                    1,360   │
│                                 │
│ [完整分析] [重大消息] [警示]   │
└─────────────────────────────────┘
```

Desktop：

- floating overlay。

Mobile / LIFF：

- bottom sheet 或 full-width modal。
- 不使用小尺寸桌面浮窗硬塞。

---

## 7. Market intelligence inspector

同樣使用浮層語彙：

```text
AI SERVER CAPEX
HIGH RELEVANCE

Why now
...

Portfolio exposure
2330 台積電        HIGH
2308 台達電        MEDIUM

Evidence
3 primary / 4 secondary sources

[完整分析]
[相關公司]
[加入觀察]
```

---

## 8. Visual tokens

以下為「從參考圖推導後，為本產品重新整理」的工程 token。
不是聲稱原圖的精確 CSS。

```text
bg.canvas         #050505
bg.shell          #0F0F0F
bg.panel          #151515
bg.panelHover     #1B1B1B
bg.overlay        #191919

border.subtle     #292929
border.strong     #3A3A3A

text.primary      #F2F2F2
text.secondary    #A8A8A8
text.muted        #737373

positive          #00C850
negative          #B23A48
warning           #D5A53A
info              #6A8DFF
```

使用原則：

- `positive` / `negative` 不作品牌色。
- 導航與普通按鈕保持中性。
- 主 CTA 可採白底黑字或淺色 outline。
- destructive action 才用 negative。

---

## 9. Typography

建議角色：

```text
UI Sans:
Inter / system sans / equivalent

Numeric / data:
IBM Plex Mono / JetBrains Mono / equivalent
```

若不希望增加字型依賴：

- 整體使用 system font。
- 重要數字使用 `font-variant-numeric: tabular-nums`。
- 價格、P/L、時間戳一律 tabular numerals。

層級：

```text
Portfolio NAV     28–36
Security price    22–28
Section heading   14–16
Body              13–15
Metadata          11–12
```

Mobile 依 viewport 調整。

---

## 10. Border / radius

參考圖最重要的不是「全部圓角」。

採：

```text
app frame radius       20–24
major shell radius     0–12
data panel radius      0–8
floating inspector     0–8
mobile bottom sheet    16–20 top corners
```

避免：

```text
所有卡片 20px radius
```

---

## 11. Button system

參考圖中按鈕偏 rectangular。

本專案：

### Primary

```text
白 / 淺底
黑字
低圓角
```

### Secondary

```text
透明背景
1px border
白 / 灰字
```

### Semantic action

例如「停用警示」：

- 不預設大紅底。
- confirmation 階段才提高 destructive emphasis。

---

## 12. LIFF mobile adaptation

參考圖本質偏 desktop dashboard，所以不能直接縮小。

Mobile 重排：

```text
Utility freshness strip
↓
Portfolio value
↓
1D / 1W / 1M compact chart
↓
Holdings list
↓
Risk snapshot
↓
Holdings news
↓
Market intelligence
```

點 holding：

```text
bottom sheet
```

不是 hover card。

---

## 13. LINE Flex adaptation

LINE Flex 只能採同一設計語言，不能複製 dashboard layout。

Flex 卡片：

- #111 / #151515 深色背景。
- 白色大數字。
- secondary gray metadata。
- 正負報酬只使用綠 / 紅。
- 1px divider。
- 按鈕採中性 outline。
- 重要消息使用小型 priority badge。
- 不用大面積鮮豔色塊。

---

## 14. Natural-language visual integration

自然語言不是獨立聊天頁。

LIFF dashboard 保留 command bar：

```text
ASK YOUR PORTFOLIO...
```

視覺風格與 utility bar 一致：

- rectangular
- thin border
- dark field
- minimal icon
- suggestion chips 不做彩色 pill

輸入：

```text
「如果所有停損都觸發，我會損失多少？」
```

結果先以一張 compact result inspector 呈現：

```text
STOP-LOSS SCENARIO
Potential downside
NT$ 61,700
4.8% NAV

Largest contributor
2330 台積電
NT$ 24,800

[查看完整風險]
```

這比在 dashboard 裡直接產生一大段聊天氣泡更符合參考圖。

---

## 15. Interaction language

參考圖的核心是「hover / inspect / drill-down」。

本專案對應：

```text
Summary
→ Inspect
→ Drill down
→ Action
```

例如：

```text
Portfolio
→ tap 2330
→ holding inspector
→ 最新消息
→ full research
→ 建立 / 修改警示
```

避免：

```text
每個功能都跳不同頁面
```

---

## 16. Design QA

Codex 前端階段必須加入 screenshot-based QA。

至少確認：

- hero hierarchy。
- desktop overlay 不遮核心資料。
- mobile inspector 改成 bottom sheet。
- red / green 沒有被濫用。
- border hierarchy 清楚。
- tabular numerals。
- stale-data banner 不被藏起來。
- 320–430px mobile viewport 不溢出。
- 交易確認 UX 不被視覺簡化掉。

---

## 17. 本參考圖最值得保留的 5 個元素

優先順序：

1. **Dark, thin-border financial shell**
2. **Large portfolio value + muted metadata**
3. **Segmented holdings visualization**
4. **Floating contextual inspector**
5. **Freshness-first utility bar**

次要：

- photographic backdrop
- crypto coin icons
- desktop-specific left rail

因此實作時，不要為了「像參考圖」犧牲 mobile usability 或資訊完整性。
