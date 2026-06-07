//+------------------------------------------------------------------+
//|                    FTMO_ProTrader_EA.mq5                         |
//|         Professional FTMO-Compliant Multi-Strategy EA            |
//|                                                                  |
//| Strategy: Multi-confluence trend-following system               |
//|  - Higher TF trend filter (EMA 200)                             |
//|  - EMA crossover signal (20/50)                                 |
//|  - RSI momentum confirmation                                     |
//|  - MACD trend confirmation                                       |
//|  - ATR-based dynamic SL/TP                                      |
//|  - Session filter (London / New York)                           |
//|  - Economic calendar news filter                                |
//|  - Full FTMO Rules enforcement                                  |
//+------------------------------------------------------------------+
#property copyright "FTMO ProTrader EA"
#property link      ""
#property version   "3.00"
#property description "Professional FTMO-Compliant Expert Advisor"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>
#include <Trade\OrderInfo.mqh>

//--- Input Groups

input group "════════ FTMO RISK MANAGEMENT ════════"
input double   InpRiskPerTrade     = 1.0;    // Risk per trade (% of balance)
input double   InpMaxDailyLoss     = 4.5;    // Max daily loss % [FTMO: 5%]
input double   InpMaxTotalLoss     = 9.0;    // Max total drawdown % [FTMO: 10%]
input double   InpProfitTarget     = 10.0;   // Profit target % [FTMO Challenge]
input int      InpMinTradingDays   = 4;      // Minimum required trading days

input group "════════ STRATEGY PARAMETERS ════════"
input ENUM_TIMEFRAMES InpMainTF    = PERIOD_H1;  // Primary signal timeframe
input ENUM_TIMEFRAMES InpTrendTF   = PERIOD_H4;  // Trend filter timeframe
input int      InpFastEMA          = 20;     // Fast EMA period
input int      InpSlowEMA          = 50;     // Slow EMA period
input int      InpTrendEMA         = 200;    // Trend EMA period
input int      InpRSIPeriod        = 14;     // RSI period
input double   InpRSIOverbought    = 65.0;   // RSI overbought threshold
input double   InpRSIOversold      = 35.0;   // RSI oversold threshold
input int      InpMACDFast         = 12;     // MACD fast period
input int      InpMACDSlow         = 26;     // MACD slow period
input int      InpMACDSignal       = 9;      // MACD signal period
input int      InpATRPeriod        = 14;     // ATR period
input double   InpATRSLMulti       = 1.5;    // ATR stop loss multiplier
input double   InpATRTPMulti       = 2.5;    // ATR take profit multiplier (RR = 1:1.67)

input group "════════ TRADE MANAGEMENT ════════"
input int      InpMaxTrades        = 1;      // Max simultaneous open trades
input bool     InpUseBreakeven     = true;   // Use breakeven
input double   InpBEAtRR           = 1.0;    // Move to breakeven at R:R ratio
input bool     InpUseTrailing      = true;   // Use trailing stop
input double   InpTrailATRMulti    = 1.0;    // Trailing stop ATR multiplier
input int      InpMagicNumber      = 202401; // EA magic number

input group "════════ SESSION FILTER ════════"
input bool     InpUseLondon        = true;   // Trade London session
input bool     InpUseNewYork       = true;   // Trade New York session
input int      InpGMTOffset        = 0;      // Your broker GMT offset (hours)

input group "════════ NEWS FILTER ════════"
input bool     InpUseNewsFilter    = true;   // Enable news filter
input int      InpNewsMinBefore    = 30;     // Minutes to avoid before news
input int      InpNewsMinAfter     = 30;     // Minutes to avoid after news
input bool     InpFilterHighImpact = true;   // Filter HIGH impact news
input bool     InpFilterMedImpact  = false;  // Filter MEDIUM impact news

input group "════════ DISPLAY SETTINGS ════════"
input bool     InpShowDashboard    = true;   // Show dashboard on chart
input uint     InpDashIntervalMs   = 250;    // Dashboard refresh interval (ms)
input color    InpDashBG           = clrMidnightBlue;  // Dashboard background
input color    InpDashText         = clrWhite;         // Dashboard text color

//--- Trade objects
CTrade         trade;
CPositionInfo  posInfo;
CAccountInfo   accInfo;
COrderInfo     ordInfo;

//--- FTMO state
double   g_initialBalance;
double   g_dailyStartBalance;
double   g_dailyStartEquity;
datetime g_lastDayTime;
int      g_tradingDaysCount;
bool     g_dailyLimitHit;
bool     g_totalLimitHit;
bool     g_profitTargetHit;
datetime g_lastTradedDay;
int      g_totalTrades;
int      g_winTrades;
int      g_lossTrades;
double   g_totalPnL;
string   g_statusMsg;

//--- Per-tick cache — refreshed ONCE at the top of OnTick, reused everywhere
double   g_balance;
double   g_equity;
int      g_openTrades;

//--- Symbol constants — set in OnInit, never change during a session
int      g_digits;
double   g_point;
long     g_stopLvl;
double   g_minLot;
double   g_maxLot;
double   g_lotStep;

//--- Pre-computed trading constants
double   g_rrRatio;       // InpATRTPMulti / InpATRSLMulti, computed once
double   g_beDist_factor; // InpBEAtRR * InpATRSLMulti, computed once

//--- Dashboard rate limiter — avoids 120+ ObjectSet + ChartRedraw on every tick
uint     g_lastDashMs;

//--- Bar detection (global so OnInit can reset it; avoids stale static on param change)
datetime g_lastBar;

//--- Indicator handles (Main TF)
int h_fastEMA, h_slowEMA, h_trendEMA;
int h_rsi, h_atr, h_macd;

//--- Indicator handles (Trend TF)
int h_fastEMA_TF, h_slowEMA_TF, h_trendEMA_TF, h_macd_TF;

//--- Dashboard object prefix
string DashPrefix = "FTMO_DASH_";

//+------------------------------------------------------------------+
//| Type declarations (must precede first use in OnTick)             |
//+------------------------------------------------------------------+
enum ENUM_SIGNAL { SIGNAL_NONE, SIGNAL_BUY, SIGNAL_SELL };

struct IndicatorValues
{
    double fastEMA[3], slowEMA[3], trendEMA[3];
    double rsi[3], atr[3];
    double macdMain[3], macdSignal[3];
    double close[3];
    double fastEMA_TF[3], slowEMA_TF[3], trendEMA_TF[3];
    double macdMain_TF[3], macdSig_TF[3];
};

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
    trade.SetExpertMagicNumber(InpMagicNumber);
    trade.SetDeviationInPoints(20);
    trade.SetTypeFilling(ORDER_FILLING_IOC);
    trade.SetAsyncMode(false);

    //--- Cache symbol constants (static for the session)
    g_digits  = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
    g_point   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
    g_stopLvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
    g_minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
    g_maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
    g_lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

    //--- Pre-compute constant factors
    g_rrRatio       = InpATRTPMulti / InpATRSLMulti;
    g_beDist_factor = InpBEAtRR * InpATRSLMulti;

    //--- Restore persisted initial balance (survives EA restarts within a challenge)
    double savedBalance = GlobalVariableGet("FTMO_InitBal_" + _Symbol);
    g_initialBalance = (savedBalance > 0) ? savedBalance : accInfo.Balance();
    GlobalVariableSet("FTMO_InitBal_" + _Symbol, g_initialBalance);

    //--- Restore persisted halt flags
    g_totalLimitHit   = (GlobalVariableGet("FTMO_TotalHalt_" + _Symbol) > 0);
    g_profitTargetHit = (GlobalVariableGet("FTMO_ProfitHit_" + _Symbol)  > 0);

    //--- Restore or initialise daily start reference (handles mid-day EA restarts)
    double   savedDaily   = GlobalVariableGet("FTMO_DayBal_"  + _Symbol);
    datetime savedDayTime = (datetime)GlobalVariableGet("FTMO_DayTime_" + _Symbol);
    datetime todayOpen    = iTime(_Symbol, PERIOD_D1, 0);
    if(savedDaily > 0 && savedDayTime == todayOpen)
    {
        g_dailyStartBalance = savedDaily;
        g_dailyStartEquity  = savedDaily;
    }
    else
    {
        g_dailyStartBalance = accInfo.Balance();
        g_dailyStartEquity  = accInfo.Equity();
        GlobalVariableSet("FTMO_DayBal_"  + _Symbol, g_dailyStartBalance);
        GlobalVariableSet("FTMO_DayTime_" + _Symbol, (double)todayOpen);
    }

    g_lastDayTime      = todayOpen;
    g_tradingDaysCount = 0;
    g_dailyLimitHit    = false;
    g_lastTradedDay    = 0;
    g_totalTrades      = 0;
    g_winTrades        = 0;
    g_lossTrades       = 0;
    g_totalPnL         = 0;
    g_statusMsg        = "Active - Scanning for signals";
    g_lastDashMs       = 0;
    g_lastBar          = 0;

    //--- Warm up per-tick cache
    g_balance    = accInfo.Balance();
    g_equity     = accInfo.Equity();
    g_openTrades = CountOpenTrades();

    if(g_totalLimitHit)   g_statusMsg = "!!! TOTAL HALT (persisted) — reset GlobalVar to clear !!!";
    if(g_profitTargetHit) g_statusMsg = "Profit target already reached — review challenge status";

    //--- Indicator handles — Main TF
    h_fastEMA  = iMA(_Symbol, InpMainTF, InpFastEMA,  0, MODE_EMA, PRICE_CLOSE);
    h_slowEMA  = iMA(_Symbol, InpMainTF, InpSlowEMA,  0, MODE_EMA, PRICE_CLOSE);
    h_trendEMA = iMA(_Symbol, InpMainTF, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);
    h_rsi      = iRSI(_Symbol, InpMainTF, InpRSIPeriod, PRICE_CLOSE);
    h_atr      = iATR(_Symbol, InpMainTF, InpATRPeriod);
    h_macd     = iMACD(_Symbol, InpMainTF, InpMACDFast, InpMACDSlow, InpMACDSignal, PRICE_CLOSE);

    //--- Indicator handles — Trend TF
    h_fastEMA_TF  = iMA(_Symbol, InpTrendTF, InpFastEMA,  0, MODE_EMA, PRICE_CLOSE);
    h_slowEMA_TF  = iMA(_Symbol, InpTrendTF, InpSlowEMA,  0, MODE_EMA, PRICE_CLOSE);
    h_trendEMA_TF = iMA(_Symbol, InpTrendTF, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);
    h_macd_TF     = iMACD(_Symbol, InpTrendTF, InpMACDFast, InpMACDSlow, InpMACDSignal, PRICE_CLOSE);

    if(h_fastEMA == INVALID_HANDLE  || h_slowEMA == INVALID_HANDLE  ||
       h_trendEMA == INVALID_HANDLE || h_rsi == INVALID_HANDLE      ||
       h_atr == INVALID_HANDLE      || h_macd == INVALID_HANDLE     ||
       h_fastEMA_TF == INVALID_HANDLE || h_slowEMA_TF == INVALID_HANDLE ||
       h_trendEMA_TF == INVALID_HANDLE || h_macd_TF == INVALID_HANDLE)
    {
        Print("[FTMO EA] ERROR: Failed to create indicator handles. Error: ", GetLastError());
        return INIT_FAILED;
    }

    if(InpShowDashboard) BuildDashboard();

    Print("[FTMO EA] v3.00 Initialized | Balance: ", g_initialBalance,
          " | Max Daily Loss: ", InpMaxDailyLoss, "% | Max DD: ", InpMaxTotalLoss, "%");

    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    IndicatorRelease(h_fastEMA);    IndicatorRelease(h_slowEMA);
    IndicatorRelease(h_trendEMA);   IndicatorRelease(h_rsi);
    IndicatorRelease(h_atr);        IndicatorRelease(h_macd);
    IndicatorRelease(h_fastEMA_TF); IndicatorRelease(h_slowEMA_TF);
    IndicatorRelease(h_trendEMA_TF);IndicatorRelease(h_macd_TF);
    DeleteDashboard();
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
    //--- Refresh per-tick cache (ONE call each — reused everywhere this tick)
    g_balance    = accInfo.Balance();
    g_equity     = accInfo.Equity();
    g_openTrades = CountOpenTrades();

    //--- 1. FTMO risk controls (uses g_balance / g_equity from cache)
    UpdateRiskManagement();

    //--- 2. Manage positions (skips CopyBuffer entirely when nothing is open)
    ManageOpenTrades();

    //--- 3. Hard limit gate
    if(g_dailyLimitHit || g_totalLimitHit)
    {
        UpdateDashboard();
        return;
    }

    //--- 4. Bar-open gate (global g_lastBar resets correctly on OnInit)
    datetime curBar = iTime(_Symbol, InpMainTF, 0);
    if(curBar == g_lastBar)
    {
        UpdateDashboard();
        return;
    }
    g_lastBar = curBar;

    //--- 5. Trading session check
    if(!IsInTradingSession())
    {
        g_statusMsg = "Outside trading session";
        UpdateDashboard();
        return;
    }

    //--- 6. News filter check
    if(InpUseNewsFilter && IsNewsTime())
    {
        g_statusMsg = "News filter active - no trading";
        UpdateDashboard();
        return;
    }

    //--- 7. Max trades check (g_openTrades already computed above)
    if(g_openTrades >= InpMaxTrades)
    {
        g_statusMsg = "Max trades open (" + IntegerToString(InpMaxTrades) + ")";
        UpdateDashboard();
        return;
    }

    //--- 8. Profit target auto-stop
    if(g_profitTargetHit)
    {
        g_statusMsg = "Profit target reached! Consider stopping.";
        UpdateDashboard();
        return;
    }

    //--- 9. Load indicators
    IndicatorValues iv;
    if(!LoadIndicators(iv))
    {
        g_statusMsg = "Indicator data unavailable";
        UpdateDashboard();
        return;
    }

    //--- 10. Signal + execution
    ENUM_SIGNAL sig = GetSignal(iv);

    if(sig == SIGNAL_BUY)
    {
        g_statusMsg = "BUY signal detected - opening trade";
        ExecuteBuy(iv.atr);
    }
    else if(sig == SIGNAL_SELL)
    {
        g_statusMsg = "SELL signal detected - opening trade";
        ExecuteSell(iv.atr);
    }
    else
    {
        g_statusMsg = "Scanning... No signal";
    }

    UpdateDashboard();
}

//+------------------------------------------------------------------+
//| Trade result callback — track wins/losses                        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
    if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
    {
        ulong deal = trans.deal;
        if(HistoryDealSelect(deal))
        {
            if(HistoryDealGetInteger(deal, DEAL_MAGIC) == InpMagicNumber)
            {
                ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);
                if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
                {
                    double profit = HistoryDealGetDouble(deal, DEAL_PROFIT);
                    g_totalTrades++;
                    g_totalPnL += profit;
                    if(profit >= 0) g_winTrades++;
                    else            g_lossTrades++;
                }
            }
        }
    }
}

//============================================================
// FTMO RISK MANAGEMENT
// Uses g_balance / g_equity from per-tick cache — no extra API calls
//============================================================

void UpdateRiskManagement()
{
    //--- Day rollover
    datetime todayBar = iTime(_Symbol, PERIOD_D1, 0);
    if(todayBar != g_lastDayTime)
    {
        g_lastDayTime       = todayBar;
        g_dailyStartBalance = g_balance;
        g_dailyStartEquity  = g_equity;
        g_dailyLimitHit     = false;
        GlobalVariableSet("FTMO_DayBal_"  + _Symbol, g_balance);
        GlobalVariableSet("FTMO_DayTime_" + _Symbol, (double)todayBar);
        Print("[FTMO EA] New trading day | Start balance: ", g_balance);
    }

    //--- Retry close if limit already hit but positions remain (broker rejection recovery)
    if((g_dailyLimitHit || g_totalLimitHit) && g_openTrades > 0)
    {
        CloseAllTrades();
        return;  // limits already enforced; skip recalculation
    }

    double dailyRef     = MathMin(g_dailyStartBalance, g_dailyStartEquity);
    double worstEquity  = MathMin(g_balance, g_equity);
    double dailyLossPct = (dailyRef - worstEquity) / g_initialBalance * 100.0;

    if(!g_dailyLimitHit && dailyLossPct >= InpMaxDailyLoss)
    {
        g_dailyLimitHit = true;
        CloseAllTrades();
        g_statusMsg = StringFormat("!!! DAILY LOSS LIMIT HIT: %.2f%% !!!", dailyLossPct);
        Print("[FTMO EA] DAILY LOSS LIMIT TRIGGERED: ", dailyLossPct, "%");
        Alert("FTMO EA: Daily loss limit hit! (", DoubleToString(dailyLossPct, 2), "%)");
        return;
    }

    double totalLossPct = (g_initialBalance - worstEquity) / g_initialBalance * 100.0;

    if(!g_totalLimitHit && totalLossPct >= InpMaxTotalLoss)
    {
        g_totalLimitHit = true;
        GlobalVariableSet("FTMO_TotalHalt_" + _Symbol, 1);
        CloseAllTrades();
        g_statusMsg = StringFormat("!!! TOTAL DD LIMIT HIT: %.2f%% !!!", totalLossPct);
        Print("[FTMO EA] TOTAL DRAWDOWN LIMIT TRIGGERED: ", totalLossPct, "%");
        Alert("FTMO EA: Total drawdown limit hit! (", DoubleToString(totalLossPct, 2), "%)");
        return;
    }

    double profitPct = (g_balance - g_initialBalance) / g_initialBalance * 100.0;
    if(!g_profitTargetHit && profitPct >= InpProfitTarget)
    {
        g_profitTargetHit = true;
        GlobalVariableSet("FTMO_ProfitHit_" + _Symbol, 1);
        Print("[FTMO EA] PROFIT TARGET REACHED: ", profitPct, "%");
        Alert("FTMO EA: Profit target reached! (", DoubleToString(profitPct, 2), "%) - Review your FTMO challenge.");
    }
}

//============================================================
// INDICATOR DATA LOADER
//============================================================

bool LoadIndicators(IndicatorValues &iv)
{
    int bars = 3;
    #define COPY_SERIES(handle, buf, dest) \
        ArraySetAsSeries(dest, true); \
        if(CopyBuffer(handle, buf, 0, bars, dest) < bars) return false;

    COPY_SERIES(h_fastEMA,  0, iv.fastEMA)
    COPY_SERIES(h_slowEMA,  0, iv.slowEMA)
    COPY_SERIES(h_trendEMA, 0, iv.trendEMA)
    COPY_SERIES(h_rsi,      0, iv.rsi)
    COPY_SERIES(h_atr,      0, iv.atr)
    COPY_SERIES(h_macd,     0, iv.macdMain)
    COPY_SERIES(h_macd,     1, iv.macdSignal)

    ArraySetAsSeries(iv.close, true);
    if(CopyClose(_Symbol, InpMainTF, 0, bars, iv.close) < bars) return false;

    COPY_SERIES(h_fastEMA_TF,  0, iv.fastEMA_TF)
    COPY_SERIES(h_slowEMA_TF,  0, iv.slowEMA_TF)
    COPY_SERIES(h_trendEMA_TF, 0, iv.trendEMA_TF)
    COPY_SERIES(h_macd_TF,     0, iv.macdMain_TF)
    COPY_SERIES(h_macd_TF,     1, iv.macdSig_TF)

    #undef COPY_SERIES
    return true;
}

//============================================================
// SIGNAL GENERATION (multi-confluence)
//============================================================

ENUM_SIGNAL GetSignal(const IndicatorValues &iv)
{
    bool htfBull = (iv.fastEMA_TF[0] > iv.slowEMA_TF[0]) &&
                   (iv.slowEMA_TF[0] > iv.trendEMA_TF[0]) &&
                   (iv.macdMain_TF[0] > iv.macdSig_TF[0]);

    bool htfBear = (iv.fastEMA_TF[0] < iv.slowEMA_TF[0]) &&
                   (iv.slowEMA_TF[0] < iv.trendEMA_TF[0]) &&
                   (iv.macdMain_TF[0] < iv.macdSig_TF[0]);

    bool emaBullCross = (iv.fastEMA[1] > iv.slowEMA[1]) && (iv.fastEMA[2] <= iv.slowEMA[2]);
    bool emaBearCross = (iv.fastEMA[1] < iv.slowEMA[1]) && (iv.fastEMA[2] >= iv.slowEMA[2]);

    bool aboveTrend = iv.close[1] > iv.trendEMA[1];
    bool belowTrend = iv.close[1] < iv.trendEMA[1];

    bool rsiBull = (iv.rsi[1] > 50.0) && (iv.rsi[1] < InpRSIOverbought);
    bool rsiBear = (iv.rsi[1] < 50.0) && (iv.rsi[1] > InpRSIOversold);

    bool macdBull = (iv.macdMain[1] > iv.macdSignal[1]) &&
                    (iv.macdMain[1] > 0.0 && iv.macdMain[1] > iv.macdMain[2]);
    bool macdBear = (iv.macdMain[1] < iv.macdSignal[1]) &&
                    (iv.macdMain[1] < 0.0 && iv.macdMain[1] < iv.macdMain[2]);

    int bullScore = (htfBull    ? 1 : 0) + (emaBullCross ? 1 : 0) +
                    (aboveTrend ? 1 : 0) + (rsiBull      ? 1 : 0) + (macdBull ? 1 : 0);
    int bearScore = (htfBear    ? 1 : 0) + (emaBearCross ? 1 : 0) +
                    (belowTrend ? 1 : 0) + (rsiBear      ? 1 : 0) + (macdBear ? 1 : 0);

    if(bullScore >= 4 && emaBullCross) return SIGNAL_BUY;
    if(bearScore >= 4 && emaBearCross) return SIGNAL_SELL;

    return SIGNAL_NONE;
}

//============================================================
// TRADE EXECUTION
// Uses per-tick g_balance and cached symbol constants
//============================================================

double CalcLotSize(double slPoints)
{
    double tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
    double tickSz  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);

    if(tickSz <= 0 || slPoints <= 0 || tickVal <= 0) return 0;

    double riskAmt  = g_balance * InpRiskPerTrade / 100.0;
    double lots     = riskAmt / ((slPoints / tickSz) * tickVal);

    lots = MathFloor(lots / g_lotStep) * g_lotStep;
    lots = MathMax(g_minLot, MathMin(g_maxLot, lots));
    return lots;
}

double GetMinSLDistance()
{
    long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
    return (g_stopLvl + spread + 5) * g_point;
}

void ExecuteBuy(const double atr[])
{
    double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    double slDist = MathMax(atr[1] * InpATRSLMulti, GetMinSLDistance());
    double tpDist = slDist * g_rrRatio;

    double sl   = NormalizeDouble(ask - slDist, g_digits);
    double tp   = NormalizeDouble(ask + tpDist, g_digits);
    double lots = CalcLotSize(slDist);

    if(lots <= 0) { Print("[FTMO EA] Buy skipped: invalid lot size"); return; }

    if(trade.Buy(lots, _Symbol, ask, sl, tp, "FTMO_BUY"))
    {
        Print("[FTMO EA] BUY | Lots:", lots, " SL:", sl, " TP:", tp,
              " Risk:", InpRiskPerTrade, "% RR:", g_rrRatio);
        RecordTradingDay();
    }
    else
        Print("[FTMO EA] BUY failed: ", trade.ResultRetcode(),
              " (", trade.ResultRetcodeDescription(), ")");
}

void ExecuteSell(const double atr[])
{
    double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    double slDist = MathMax(atr[1] * InpATRSLMulti, GetMinSLDistance());
    double tpDist = slDist * g_rrRatio;

    double sl   = NormalizeDouble(bid + slDist, g_digits);
    double tp   = NormalizeDouble(bid - tpDist, g_digits);
    double lots = CalcLotSize(slDist);

    if(lots <= 0) { Print("[FTMO EA] Sell skipped: invalid lot size"); return; }

    if(trade.Sell(lots, _Symbol, bid, sl, tp, "FTMO_SELL"))
    {
        Print("[FTMO EA] SELL | Lots:", lots, " SL:", sl, " TP:", tp,
              " Risk:", InpRiskPerTrade, "% RR:", g_rrRatio);
        RecordTradingDay();
    }
    else
        Print("[FTMO EA] SELL failed: ", trade.ResultRetcode(),
              " (", trade.ResultRetcodeDescription(), ")");
}

//============================================================
// TRADE MANAGEMENT — Breakeven + Trailing Stop
// Early-exits when no positions (avoids CopyBuffer on idle ticks)
// Uses cached g_digits / g_point / g_stopLvl
// Constants hoisted outside position loop
//============================================================

void ManageOpenTrades()
{
    if(g_openTrades == 0) return;  // nothing to manage — skip CopyBuffer

    double atrBuf[];
    ArraySetAsSeries(atrBuf, true);
    if(CopyBuffer(h_atr, 0, 0, 3, atrBuf) < 3) return;
    double atr = atrBuf[0];

    //--- Hoist constants that are the same for every position
    double minDist  = (g_stopLvl + 5) * g_point;
    double beDist   = atr * g_beDist_factor;
    double trailDst = atr * InpTrailATRMulti;

    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if(!posInfo.SelectByIndex(i)) continue;
        if(posInfo.Symbol() != _Symbol)        continue;
        if(posInfo.Magic()  != InpMagicNumber) continue;

        ulong  ticket = posInfo.Ticket();
        double openPx = posInfo.PriceOpen();
        double curSL  = posInfo.StopLoss();
        double curTP  = posInfo.TakeProfit();
        ENUM_POSITION_TYPE pType = posInfo.PositionType();

        if(pType == POSITION_TYPE_BUY)
        {
            double bid       = SymbolInfoDouble(_Symbol, SYMBOL_BID);
            double profitDst = bid - openPx;

            if(InpUseBreakeven && profitDst >= beDist)
            {
                double newSL = NormalizeDouble(openPx + 2 * g_point, g_digits);
                if(newSL > curSL && (bid - newSL) >= minDist)
                    trade.PositionModify(ticket, newSL, curTP);
            }

            if(InpUseTrailing && profitDst >= trailDst * 1.5)
            {
                double newSL = NormalizeDouble(bid - trailDst, g_digits);
                if(newSL > curSL && (bid - newSL) >= minDist)
                    trade.PositionModify(ticket, newSL, curTP);
            }
        }
        else if(pType == POSITION_TYPE_SELL)
        {
            double ask       = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
            double profitDst = openPx - ask;

            if(InpUseBreakeven && profitDst >= beDist)
            {
                double newSL = NormalizeDouble(openPx + 2 * g_point, g_digits);
                if((curSL == 0 || newSL < curSL) && (newSL - ask) >= minDist)
                    trade.PositionModify(ticket, newSL, curTP);
            }

            if(InpUseTrailing && profitDst >= trailDst * 1.5)
            {
                double newSL = NormalizeDouble(ask + trailDst, g_digits);
                if((curSL == 0 || newSL < curSL) && (newSL - ask) >= minDist)
                    trade.PositionModify(ticket, newSL, curTP);
            }
        }
    }
}

//============================================================
// SESSION FILTER
//============================================================

bool IsInTradingSession()
{
    MqlDateTime dt;
    datetime    gmtTime = TimeGMT() + InpGMTOffset * 3600;
    TimeToStruct(gmtTime, dt);

    int h   = dt.hour;
    int dow = dt.day_of_week;

    if(dow == 0 || dow == 6)           return false;
    if(dow == 5 && h >= 21)            return false;
    if(dow == 1 && h == 0)             return false;

    if(InpUseLondon  && h >= 8  && h < 16) return true;
    if(InpUseNewYork && h >= 13 && h < 21) return true;

    return false;
}

//============================================================
// NEWS FILTER (MT5 built-in economic calendar, UTC-correct)
// Single CalendarValueHistory query per currency pair per bar
//============================================================

bool IsNewsTime()
{
    datetime now  = TimeGMT();
    datetime from = now - InpNewsMinBefore * 60;
    datetime to   = now + InpNewsMinAfter  * 60;

    string base  = StringSubstr(_Symbol, 0, 3);
    string quote = StringSubstr(_Symbol, 3, 3);

    MqlCalendarValue values[];

    //--- Base currency events
    int n = CalendarValueHistory(values, from, to, NULL, base);
    for(int i = 0; i < n; i++)
    {
        MqlCalendarEvent ev;
        if(!CalendarEventById(values[i].event_id, ev)) continue;
        if(InpFilterHighImpact && ev.importance == CALENDAR_IMPORTANCE_HIGH)     return true;
        if(InpFilterMedImpact  && ev.importance == CALENDAR_IMPORTANCE_MODERATE) return true;
    }

    //--- Quote currency events
    n = CalendarValueHistory(values, from, to, NULL, quote);
    for(int i = 0; i < n; i++)
    {
        MqlCalendarEvent ev;
        if(!CalendarEventById(values[i].event_id, ev)) continue;
        if(InpFilterHighImpact && ev.importance == CALENDAR_IMPORTANCE_HIGH)     return true;
        if(InpFilterMedImpact  && ev.importance == CALENDAR_IMPORTANCE_MODERATE) return true;
    }

    return false;
}

//============================================================
// UTILITY
//============================================================

int CountOpenTrades()
{
    int n = 0;
    for(int i = PositionsTotal() - 1; i >= 0; i--)
        if(posInfo.SelectByIndex(i) &&
           posInfo.Symbol() == _Symbol &&
           posInfo.Magic()  == InpMagicNumber)
            n++;
    return n;
}

void CloseAllTrades()
{
    for(int i = PositionsTotal() - 1; i >= 0; i--)
        if(posInfo.SelectByIndex(i) &&
           posInfo.Symbol() == _Symbol &&
           posInfo.Magic()  == InpMagicNumber)
            trade.PositionClose(posInfo.Ticket());
}

void RecordTradingDay()
{
    datetime today = iTime(_Symbol, PERIOD_D1, 0);
    if(today != g_lastTradedDay)
    {
        g_lastTradedDay = today;
        g_tradingDaysCount++;
        Print("[FTMO EA] Trading day #", g_tradingDaysCount, " recorded");
    }
}

//============================================================
// ON-CHART DASHBOARD
// Rate-limited: redraws at most InpDashIntervalMs ms (default 250 ms)
// Uses per-tick cache g_balance / g_equity / g_openTrades
//============================================================

void CreateLabel(string name, string text, int x, int y, int fontSize,
                 color clr, ENUM_ANCHOR_POINT anchor = ANCHOR_LEFT_UPPER)
{
    if(ObjectFind(0, name) < 0)
    {
        ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
        ObjectSetInteger(0, name, OBJPROP_CORNER,    CORNER_LEFT_UPPER);
        ObjectSetInteger(0, name, OBJPROP_ANCHOR,    anchor);
        ObjectSetInteger(0, name, OBJPROP_BACK,      false);
        ObjectSetInteger(0, name, OBJPROP_SELECTABLE,false);
        ObjectSetString (0, name, OBJPROP_FONT,      "Consolas");
    }
    ObjectSetString (0, name, OBJPROP_TEXT,      text);
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
    ObjectSetInteger(0, name, OBJPROP_FONTSIZE,  fontSize);
    ObjectSetInteger(0, name, OBJPROP_COLOR,     clr);
}

void CreateRect(string name, int x, int y, int width, int height, color clr)
{
    if(ObjectFind(0, name) < 0)
        ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);

    ObjectSetInteger(0, name, OBJPROP_CORNER,      CORNER_LEFT_UPPER);
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE,   x);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE,   y);
    ObjectSetInteger(0, name, OBJPROP_XSIZE,       width);
    ObjectSetInteger(0, name, OBJPROP_YSIZE,       height);
    ObjectSetInteger(0, name, OBJPROP_BGCOLOR,     clr);
    ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
    ObjectSetInteger(0, name, OBJPROP_BACK,        true);
    ObjectSetInteger(0, name, OBJPROP_SELECTABLE,  false);
}

void BuildDashboard()
{
    CreateRect(DashPrefix+"BG", 10, 25, 310, 285, InpDashBG);
    ChartRedraw(0);
}

void UpdateDashboard()
{
    if(!InpShowDashboard) return;

    //--- Rate limiter: skip redraw if last update was less than InpDashIntervalMs ago
    uint now = GetTickCount();
    if(now - g_lastDashMs < InpDashIntervalMs) return;
    g_lastDashMs = now;

    //--- All values sourced from per-tick cache — no extra API calls here
    double profitPct = (g_balance - g_initialBalance) / g_initialBalance * 100.0;
    double dailyRef  = MathMin(g_dailyStartBalance, g_dailyStartEquity);
    double dailyLoss = (dailyRef - MathMin(g_balance, g_equity)) / g_initialBalance * 100.0;
    double totalDD   = (g_initialBalance - MathMin(g_balance, g_equity)) / g_initialBalance * 100.0;
    double winRate   = (g_totalTrades > 0) ? (double)g_winTrades / g_totalTrades * 100.0 : 0.0;

    color titleClr = InpDashText;
    color valClr   = clrLightGreen;
    color warnClr  = clrOrange;
    color alertClr = clrRed;

    int x = 15, y = 30, dy = 18;

    CreateLabel(DashPrefix+"T0", "▌ FTMO ProTrader EA v3",      x, y,       9, clrCyan);
    CreateLabel(DashPrefix+"T1", "━━━━━━━━━━━━━━━━━━━━━━━━━━━",  x, y+dy,   7, clrDimGray);

    CreateLabel(DashPrefix+"L1", "Account Balance:",  x,     y+dy*2, 8, titleClr);
    CreateLabel(DashPrefix+"V1", StringFormat("$%.2f", g_balance), x+155, y+dy*2, 8, valClr);

    CreateLabel(DashPrefix+"L2", "Account Equity:",   x,     y+dy*3, 8, titleClr);
    CreateLabel(DashPrefix+"V2", StringFormat("$%.2f", g_equity),   x+155, y+dy*3, 8, valClr);

    CreateLabel(DashPrefix+"L3", "P&L (all time):",   x,     y+dy*4, 8, titleClr);
    CreateLabel(DashPrefix+"V3", StringFormat("%.2f%%", profitPct),
                x+155, y+dy*4, 8, (profitPct >= 0) ? clrLightGreen : clrRed);

    CreateLabel(DashPrefix+"T2", "━━━━━━━━━━━━━━━━━━━━━━━━━━━",  x, y+dy*5, 7, clrDimGray);
    CreateLabel(DashPrefix+"LH", "FTMO LIMITS",        x, y+dy*6,   8, clrCyan);

    color dlClr = (dailyLoss >= InpMaxDailyLoss*0.8) ? alertClr :
                  (dailyLoss >= InpMaxDailyLoss*0.5) ? warnClr : valClr;
    CreateLabel(DashPrefix+"L4", "Daily Loss:",  x,     y+dy*7, 8, titleClr);
    CreateLabel(DashPrefix+"V4", StringFormat("%.2f%% / %.1f%%", dailyLoss, InpMaxDailyLoss),
                x+155, y+dy*7, 8, dlClr);

    color ddClr = (totalDD >= InpMaxTotalLoss*0.8) ? alertClr :
                  (totalDD >= InpMaxTotalLoss*0.5) ? warnClr : valClr;
    CreateLabel(DashPrefix+"L5", "Total Drawdown:", x,  y+dy*8, 8, titleClr);
    CreateLabel(DashPrefix+"V5", StringFormat("%.2f%% / %.1f%%", totalDD, InpMaxTotalLoss),
                x+155, y+dy*8, 8, ddClr);

    CreateLabel(DashPrefix+"L6", "Profit Target:", x,   y+dy*9, 8, titleClr);
    CreateLabel(DashPrefix+"V6", StringFormat("%.2f%% / %.1f%%", profitPct, InpProfitTarget),
                x+155, y+dy*9, 8, (profitPct >= InpProfitTarget) ? clrGold : valClr);

    CreateLabel(DashPrefix+"L7", "Trading Days:", x,    y+dy*10, 8, titleClr);
    CreateLabel(DashPrefix+"V7", StringFormat("%d / %d min", g_tradingDaysCount, InpMinTradingDays),
                x+155, y+dy*10, 8, (g_tradingDaysCount >= InpMinTradingDays) ? clrGold : warnClr);

    CreateLabel(DashPrefix+"T3", "━━━━━━━━━━━━━━━━━━━━━━━━━━━",  x, y+dy*11, 7, clrDimGray);
    CreateLabel(DashPrefix+"LS", "STATISTICS",  x, y+dy*12, 8, clrCyan);

    CreateLabel(DashPrefix+"L8", "Open Trades:",  x,   y+dy*13, 8, titleClr);
    CreateLabel(DashPrefix+"V8", IntegerToString(g_openTrades),
                x+155, y+dy*13, 8, (g_openTrades > 0) ? clrYellow : valClr);

    CreateLabel(DashPrefix+"L9", "Total Trades:", x,   y+dy*14, 8, titleClr);
    CreateLabel(DashPrefix+"V9", IntegerToString(g_totalTrades), x+155, y+dy*14, 8, valClr);

    CreateLabel(DashPrefix+"LA", "Win Rate:",     x,   y+dy*15, 8, titleClr);
    CreateLabel(DashPrefix+"VA", StringFormat("%.1f%% (%dW/%dL)", winRate, g_winTrades, g_lossTrades),
                x+155, y+dy*15, 8,
                (winRate >= 50) ? clrLightGreen : (winRate > 0) ? warnClr : clrGray);

    CreateLabel(DashPrefix+"T4", "━━━━━━━━━━━━━━━━━━━━━━━━━━━", x, y+dy*14+18, 7, clrDimGray);
    CreateLabel(DashPrefix+"STATUS", g_statusMsg, x, y+dy*15+18, 7,
                (g_dailyLimitHit || g_totalLimitHit) ? alertClr :
                (g_profitTargetHit ? clrGold : clrLightBlue));

    ChartRedraw(0);
}

void DeleteDashboard()
{
    ObjectsDeleteAll(0, DashPrefix);
    ChartRedraw(0);
}
//+------------------------------------------------------------------+
