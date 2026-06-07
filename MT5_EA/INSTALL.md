# FTMO ProTrader EA — Installation & Usage Guide

## Files

| File | Description |
|------|-------------|
| `FTMO_ProTrader_EA.mq5` | Main Expert Advisor (copy to MT5 Experts folder) |
| `FTMO_Optimizer.mq5` | Monte Carlo stress-test script (copy to MT5 Scripts folder) |
| `FTMO_BacktestConfig.set` | Strategy Tester settings preset |

---

## Quick Start

### 1. Install the EA
```
MetaTrader 5 → File → Open Data Folder
→ MQL5 → Experts → paste FTMO_ProTrader_EA.mq5
→ Refresh (F5 in Navigator)
```

### 2. Compile
Open MetaEditor (F4), open the file, press **F7** to compile.  
Zero errors expected.

### 3. Backtest first (mandatory before live use)
- Open **Strategy Tester** (Ctrl+R)
- Load `FTMO_BacktestConfig.set`
- Model: **Every tick based on real ticks**
- Date range: minimum 1 year of data
- Press Start

### 4. Attach to live/demo chart
- Open a chart (EURUSD H1 recommended)
- Drag EA from Navigator to chart
- **Enable AutoTrading**
- Configure inputs (see below)

---

## First Connection Checklist

Work top to bottom — each step depends on the one before it.

- [ ] **1. Install MT5** — download from your broker (Windows native; Mac/Linux via Wine).
- [ ] **2. Log into the trading account** — `File → Login to Trading Account`, enter
      the **Login / Password / Server** your broker (or FTMO) emailed you. Bottom-right
      should show a live connection with a moving bid/ask.
- [ ] **3. Enable the economic calendar** — `Tools → Options → Server →` tick
      *"Enable news"* (required for the news filter).
- [ ] **4. Copy the files** — `File → Open Data Folder`:
      - `FTMO_ProTrader_EA.mq5` → `MQL5/Experts/`
      - `FTMO_UnitTests.mq5` + `FTMO_Optimizer.mq5` → `MQL5/Scripts/`
- [ ] **5. Compile** — open the EA in MetaEditor (F4) → **F7**. Expect **0 errors**.
- [ ] **6. Refresh** — back in MT5, press **F5** in the Navigator panel.
- [ ] **7. Run the unit tests first** — drag `FTMO_UnitTests` onto any chart →
      check the **Experts/Journal** tab for `ALL TESTS PASSED ✓`.
- [ ] **8. Backtest** — `Ctrl+R`, load `FTMO_BacktestConfig.set`, model
      *"Every tick based on real ticks"*, ≥ 1 year of data → Start.
- [ ] **9. Attach to a demo chart** — EURUSD H1, drag EA on, **Common → Allow Algo Trading**,
      then click the toolbar **Algo Trading** button (must be green).
- [ ] **10. Confirm** — the dashboard appears top-left and shows your live balance.
- [ ] **11. Only after a clean demo run** — repeat on the funded FTMO Challenge account.

> **Connection sanity check:** if the dashboard balance reads `$0.00` or the chart shows
> no ticks, you are not logged into a trading account — redo step 2.

---

## FTMO Rule Compliance

| FTMO Rule | EA Setting | Default |
|-----------|-----------|---------|
| Max Daily Loss 5% | `InpMaxDailyLoss` | **4.5%** (0.5% buffer) |
| Max Total Loss 10% | `InpMaxTotalLoss` | **9.0%** (1% buffer) |
| Profit Target 10% | `InpProfitTarget` | 10.0% |
| Min 4 trading days | `InpMinTradingDays` | 4 |
| No weekend trading | Hard-coded | Always on |
| No high-impact news | `InpUseNewsFilter` | true |

> **The EA stops trading automatically** when daily or total loss limits are hit.  
> An Alert box + console message fires immediately.

---

## Strategy Logic

```
Entry requires 4/5 confluence factors:

1. H4 trend: FastEMA > SlowEMA > EMA200 + MACD bullish  (HTF Trend)
2. H1 EMA cross: FastEMA(20) crosses above SlowEMA(50)   (Signal)
3. Price above EMA200 on H1                              (Trend Filter)
4. RSI(14) between 50–65 (not overbought)                (Momentum)
5. MACD histogram rising / above signal line             (Confirmation)

Stop Loss  : 1.5 × ATR(14)
Take Profit: 2.5 × ATR(14)  →  Risk:Reward ≈ 1:1.67
Breakeven  : moves to BE when price moves 1 × SL distance in profit
Trailing   : activates at 1.5× ATR profit, trails by 1× ATR
```

---

## Recommended Settings

### Conservative (safest for FTMO)
- Risk per trade: **0.5%**
- Max Daily Loss: **4.0%**
- Max Total Loss: **8.0%**

### Standard (default)
- Risk per trade: **1.0%**
- Max Daily Loss: **4.5%**
- Max Total Loss: **9.0%**

### Aggressive (higher reward, higher risk of hitting limits)
- Risk per trade: **1.5%**
- Max Daily Loss: **4.5%**
- Max Total Loss: **9.0%**

---

## Running the Monte Carlo Validator

1. Export trade history from Strategy Tester as CSV
2. Edit the file to contain only P&L values (one per line, e.g. `150.25`)
3. Copy to `MQL5/Files/FTMO_trades.csv`
4. Run `FTMO_Optimizer` script on any chart
5. Check the Journal tab for results — aim for **≥70% FTMO pass rate**

---

## Broker Requirements

- MT5 platform
- ECN/STP broker (low spread, fast execution)
- Recommended spread: < 1.5 pips on EURUSD
- GMT offset: set `InpGMTOffset` to match your broker's server time

---

## Built-in Safety Features (v3.10)

| Feature | What it does |
|---------|--------------|
| **Input validation** | EA refuses to load (`INIT_PARAMETERS_INCORRECT`) if any setting could violate an FTMO hard limit (daily ≥ 5%, total ≥ 10%), or if EMA/RSI periods are mis-ordered. Check the Experts tab for `CONFIG ERROR` lines. |
| **Spread filter** | `InpMaxSpreadPoints` (default 30) blocks new entries when the spread blows out during news or thin liquidity — protects the intended risk:reward. |
| **Over-risk guard** | If the minimum lot would risk more than 1.5× your target (small account / wide SL), the trade is skipped instead of silently over-risking. |
| **State persistence** | Initial balance, daily baseline, and halt flags survive an EA restart (MT5 GlobalVariables), so a mid-challenge reattach can't reset your drawdown reference. |
| **Auto-halt + retry close** | On a daily/total limit breach the EA closes all positions and keeps retrying if the broker rejects a close. |

> To clear a persisted halt after a challenge reset: `Tools → Global Variables (F3)`
> and delete the `FTMO_*` entries for your symbol.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `CONFIG ERROR` in Experts tab, EA won't run | An input failed validation — read the printed line and fix that input. |
| Dashboard shows `$0.00` balance | Not logged into a trading account (step 2 of the checklist). |
| EA loads but never trades | Outside session hours, news filter active, max trades open, or no 4/5 confluence yet — the dashboard **Status** line tells you which. |
| "Spread too wide — entry skipped" | Spread > `InpMaxSpreadPoints`. Normal around news; raise the limit only if your broker's typical spread is genuinely higher. |
| Trades skipped: "min lot would risk…" | Account too small / SL too wide for your risk %. Lower `InpATRSLMulti` or accept the skip. |
| News filter never triggers | Economic calendar not enabled (`Tools → Options → Server → Enable news`). |
| Session times look shifted | Set `InpGMTOffset` only if you need to nudge the GMT-based session windows for your broker's clock. |
| Compile errors in MetaEditor | Ensure the four `#include <Trade\...>` files exist (standard MT5 install) and you compiled with a current build. |

---

## Warnings

- Past backtests do not guarantee future results
- Always run on a **demo account** before the FTMO challenge
- The news filter requires MT5's built-in economic calendar (enabled by default)
- Do **not** change magic number mid-challenge; existing positions will be unmanaged
