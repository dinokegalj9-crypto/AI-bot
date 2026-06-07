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

## Warnings

- Past backtests do not guarantee future results
- Always run on a **demo account** before the FTMO challenge
- The news filter requires MT5's built-in economic calendar (enabled by default)
- Do **not** change magic number mid-challenge; existing positions will be unmanaged
