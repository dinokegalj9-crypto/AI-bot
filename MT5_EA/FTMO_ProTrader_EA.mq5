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
#property version   "2.00"
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
input color    InpDashBG           = clrMidnightBlue;  // Dashboard background
input color    InpDashText         = clrWhite;         // Dashboard text color

//--- Global Objects
CTrade         trade;
CPositionInfo  posInfo;
CAccountInfo   accInfo;
COrderInfo     ordInfo;

//--- Account tracking
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

//--- Indicator handles (Main TF)
int h_fastEMA, h_slowEMA, h_trendEMA;
int h_rsi, h_atr, h_macd;

//--- Indicator handles (Trend TF)
int h_fastEMA_TF, h_slowEMA_TF, h_trendEMA_TF, h_macd_TF;

//--- Dashboard label names
string DashPrefix = "FTMO_DASH_";

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
    //--- Configure trade object
    trade.SetExpertMagicNumber(InpMagicNumber);
    trade.SetDeviationInPoints(20);
    trade.SetTypeFilling(ORDER_FILLING_IOC);
    trade.SetAsyncMode(false);

    //--- Initialize account tracking
    g_initialBalance     = accInfo.Balance();
    g_dailyStartBalance  = g_initialBalance;
    g_dailyStartEquity   = accInfo.Equity();
    g_lastDayTime        = iTime(_Symbol, PERIOD_D1, 0);
    g_tradingDaysCount   = 0;
    g_dailyLimitHit      = false;
    g_totalLimitHit      = false;
    g_profitTargetHit    = false;
    g_lastTradedDay      = 0;
    g_totalTrades        = 0;
    g_winTrades          = 0;
    g_lossTrades         = 0;
    g_totalPnL           = 0;
    g_statusMsg          = "Active - Scanning for signals";

    //--- Create indicator handles - Main TF
    h_fastEMA  = iMA(_Symbol, InpMainTF, InpFastEMA,  0, MODE_EMA, PRICE_CLOSE);
    h_slowEMA  = iMA(_Symbol, InpMainTF, InpSlowEMA,  0, MODE_EMA, PRICE_CLOSE);
    h_trendEMA = iMA(_Symbol, InpMainTF, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);
    h_rsi      = iRSI(_Symbol, InpMainTF, InpRSIPeriod, PRICE_CLOSE);
    h_atr      = iATR(_Symbol, InpMainTF, InpATRPeriod);
    h_macd     = iMACD(_Symbol, InpMainTF, InpMACDFast, InpMACDSlow, InpMACDSignal, PRICE_CLOSE);

    //--- Create indicator handles - Trend TF
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

    //--- Build dashboard
    if(InpShowDashboard) BuildDashboard();

    Print("[FTMO EA] Initialized | Balance: ", g_initialBalance,
          " | Max Daily Loss: ", InpMaxDailyLoss, "% | Max DD: ", InpMaxTotalLoss, "%");

    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    IndicatorRelease(h_fastEMA);   IndicatorRelease(h_slowEMA);
    IndicatorRelease(h_trendEMA);  IndicatorRelease(h_rsi);
    IndicatorRelease(h_atr);       IndicatorRelease(h_macd);
    IndicatorRelease(h_fastEMA_TF); IndicatorRelease(h_slowEMA_TF);
    IndicatorRelease(h_trendEMA_TF); IndicatorRelease(h_macd_TF);
    DeleteDashboard();
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
    //--- 1. Update FTMO risk controls every tick
    UpdateRiskManagement();

    //--- 2. Always manage existing positions (SL/TP/BE/Trail)
    ManageOpenTrades();

    //--- 3. If any hard limit is hit — stop trading
    if(g_dailyLimitHit || g_totalLimitHit)
    {
        UpdateDashboard();
        return;
    }

    //--- 4. Only look for new signals on bar open
    static datetime s_lastBar = 0;
    datetime curBar = iTime(_Symbol, InpMainTF, 0);
    if(curBar == s_lastBar)
    {
        UpdateDashboard();
        return;
    }
    s_lastBar = curBar;

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

    //--- 7. Max trades check
    if(CountOpenTrades() >= InpMaxTrades)
    {
        g_statusMsg = "Max trades open (" + IntegerToString(InpMaxTrades) + ")";
        UpdateDashboard();
        return;
    }

    //--- 8. Profit target — optional auto-stop
    if(g_profitTargetHit)
    {
        g_statusMsg = "Profit target reached! Consider stopping.";
        UpdateDashboard();
        return;
    }

    //--- 9. Load indicator values
    IndicatorValues iv;
    if(!LoadIndicators(iv))
    {
        g_statusMsg = "Indicator data unavailable";
        UpdateDashboard();
        return;
    }

    //--- 10. Generate signal
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
//============================================================

void UpdateRiskManagement()
{
    double balance = accInfo.Balance();
    double equity  = accInfo.Equity();

    //--- Daily reset check
    datetime todayBar = iTime(_Symbol, PERIOD_D1, 0);
    if(todayBar != g_lastDayTime)
    {
        g_lastDayTime       = todayBar;
        g_dailyStartBalance = balance;
        g_dailyStartEquity  = equity;
        g_dailyLimitHit     = false;
        Print("[FTMO EA] New trading day | Start balance: ", balance);
    }

    //--- Daily loss check (worst of equity/balance vs daily start)
    double dailyRef   = MathMin(g_dailyStartBalance, g_dailyStartEquity);
    double worstEquity= MathMin(balance, equity);
    double dailyLossPct = (dailyRef - worstEquity) / g_initialBalance * 100.0;

    if(!g_dailyLimitHit && dailyLossPct >= InpMaxDailyLoss)
    {
        g_dailyLimitHit = true;
        CloseAllTrades();
        g_statusMsg = StringFormat("!!! DAILY LOSS LIMIT HIT: %.2f%% !!!", dailyLossPct);
        Print("[FTMO EA] DAILY LOSS LIMIT TRIGGERED: ", dailyLossPct, "%");
        Alert("FTMO EA: Daily loss limit hit! (", DoubleToString(dailyLossPct, 2), "%)");
    }

    //--- Total drawdown check (from initial balance)
    double totalLossPct = (g_initialBalance - worstEquity) / g_initialBalance * 100.0;

    if(!g_totalLimitHit && totalLossPct >= InpMaxTotalLoss)
    {
        g_totalLimitHit = true;
        CloseAllTrades();
        g_statusMsg = StringFormat("!!! TOTAL DD LIMIT HIT: %.2f%% !!!", totalLossPct);
        Print("[FTMO EA] TOTAL DRAWDOWN LIMIT TRIGGERED: ", totalLossPct, "%");
        Alert("FTMO EA: Total drawdown limit hit! (", DoubleToString(totalLossPct, 2), "%)");
    }

    //--- Profit target check
    double profitPct = (balance - g_initialBalance) / g_initialBalance * 100.0;
    if(!g_profitTargetHit && profitPct >= InpProfitTarget)
    {
        g_profitTargetHit = true;
        Print("[FTMO EA] PROFIT TARGET REACHED: ", profitPct, "%");
        Alert("FTMO EA: Profit target reached! (", DoubleToString(profitPct, 2), "%) - Review your FTMO challenge.");
    }
}

//============================================================
// INDICATOR DATA STRUCTURE & LOADER
//============================================================

struct IndicatorValues
{
    // Main TF
    double fastEMA[3], slowEMA[3], trendEMA[3];
    double rsi[3], atr[3];
    double macdMain[3], macdSignal[3];
    // Trend TF
    double fastEMA_TF[3], slowEMA_TF[3], trendEMA_TF[3];
    double macdMain_TF[3], macdSig_TF[3];
};

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

    COPY_SERIES(h_fastEMA_TF,  0, iv.fastEMA_TF)
    COPY_SERIES(h_slowEMA_TF,  0, iv.slowEMA_TF)
    COPY_SERIES(h_trendEMA_TF, 0, iv.trendEMA_TF)
    COPY_SERIES(h_macd_TF,     0, iv.macdMain_TF)
    COPY_SERIES(h_macd_TF,     1, iv.macdSig_TF)

    #undef COPY_SERIES
    return true;
}

//============================================================
// SIGNAL GENERATION  (multi-confluence)
//============================================================

enum ENUM_SIGNAL { SIGNAL_NONE, SIGNAL_BUY, SIGNAL_SELL };

ENUM_SIGNAL GetSignal(const IndicatorValues &iv)
{
    //--- Higher TF Trend Direction
    bool htfBull = (iv.fastEMA_TF[0] > iv.slowEMA_TF[0]) &&
                   (iv.slowEMA_TF[0] > iv.trendEMA_TF[0]) &&
                   (iv.macdMain_TF[0] > iv.macdSig_TF[0]);

    bool htfBear = (iv.fastEMA_TF[0] < iv.slowEMA_TF[0]) &&
                   (iv.slowEMA_TF[0] < iv.trendEMA_TF[0]) &&
                   (iv.macdMain_TF[0] < iv.macdSig_TF[0]);

    //--- Main TF: EMA crossover (bar [1] had cross, bar [0] confirms)
    bool emaBullCross = (iv.fastEMA[1] > iv.slowEMA[1]) && (iv.fastEMA[2] <= iv.slowEMA[2]);
    bool emaBearCross = (iv.fastEMA[1] < iv.slowEMA[1]) && (iv.fastEMA[2] >= iv.slowEMA[2]);

    //--- Price vs 200 EMA
    double closePrice = iClose(_Symbol, InpMainTF, 1);
    bool aboveTrend = closePrice > iv.trendEMA[1];
    bool belowTrend = closePrice < iv.trendEMA[1];

    //--- RSI confirmation (not overbought/oversold, momentum aligned)
    bool rsiBull = (iv.rsi[1] > 50.0) && (iv.rsi[1] < InpRSIOverbought);
    bool rsiBear = (iv.rsi[1] < 50.0) && (iv.rsi[1] > InpRSIOversold);

    //--- MACD confirmation on main TF
    bool macdBull = (iv.macdMain[1] > iv.macdSignal[1]) && (iv.macdMain[1] > 0.0 || iv.macdMain[1] > iv.macdMain[2]);
    bool macdBear = (iv.macdMain[1] < iv.macdSignal[1]) && (iv.macdMain[1] < 0.0 || iv.macdMain[1] < iv.macdMain[2]);

    //--- Confluence: need HTF trend + EMA cross + price location + RSI + MACD
    int bullScore = (htfBull ? 1 : 0) + (emaBullCross ? 1 : 0) +
                    (aboveTrend ? 1 : 0) + (rsiBull ? 1 : 0) + (macdBull ? 1 : 0);

    int bearScore = (htfBear ? 1 : 0) + (emaBearCross ? 1 : 0) +
                    (belowTrend ? 1 : 0) + (rsiBear ? 1 : 0) + (macdBear ? 1 : 0);

    //--- Require at least 4/5 confluence factors
    if(bullScore >= 4 && emaBullCross) return SIGNAL_BUY;
    if(bearScore >= 4 && emaBearCross) return SIGNAL_SELL;

    return SIGNAL_NONE;
}

//============================================================
// TRADE EXECUTION
//============================================================

double CalcLotSize(double slPoints)
{
    double balance   = accInfo.Balance();
    double riskAmt   = balance * InpRiskPerTrade / 100.0;
    double tickVal   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
    double tickSz    = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
    double point     = SymbolInfoDouble(_Symbol, SYMBOL_POINT);

    if(tickSz <= 0 || slPoints <= 0 || tickVal <= 0) return 0;

    double ticksInSL = slPoints / tickSz;
    double lots      = riskAmt / (ticksInSL * tickVal);

    double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
    double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
    double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

    lots = MathFloor(lots / lotStep) * lotStep;
    lots = MathMax(minLot, MathMin(maxLot, lots));
    return lots;
}

double GetMinSLDistance()
{
    long stopLvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
    long spread  = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
    double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
    return (stopLvl + spread + 5) * point;
}

void ExecuteBuy(const double atr[])
{
    double ask      = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    double slDist   = MathMax(atr[1] * InpATRSLMulti, GetMinSLDistance());
    double tpDist   = atr[1] * InpATRTPMulti;
    int    digits   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

    double sl   = NormalizeDouble(ask - slDist, digits);
    double tp   = NormalizeDouble(ask + tpDist, digits);
    double lots = CalcLotSize(slDist);

    if(lots <= 0)
    {
        Print("[FTMO EA] Buy skipped: invalid lot size");
        return;
    }

    if(trade.Buy(lots, _Symbol, ask, sl, tp, "FTMO_BUY"))
    {
        Print("[FTMO EA] BUY opened | Lots:", lots, " SL:", sl, " TP:", tp,
              " Risk:", InpRiskPerTrade, "% RR:", InpATRTPMulti/InpATRSLMulti);
        RecordTradingDay();
    }
    else
    {
        Print("[FTMO EA] BUY failed: ", trade.ResultRetcode(),
              " (", trade.ResultRetcodeDescription(), ")");
    }
}

void ExecuteSell(const double atr[])
{
    double bid      = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    double slDist   = MathMax(atr[1] * InpATRSLMulti, GetMinSLDistance());
    double tpDist   = atr[1] * InpATRTPMulti;
    int    digits   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

    double sl   = NormalizeDouble(bid + slDist, digits);
    double tp   = NormalizeDouble(bid - tpDist, digits);
    double lots = CalcLotSize(slDist);

    if(lots <= 0)
    {
        Print("[FTMO EA] Sell skipped: invalid lot size");
        return;
    }

    if(trade.Sell(lots, _Symbol, bid, sl, tp, "FTMO_SELL"))
    {
        Print("[FTMO EA] SELL opened | Lots:", lots, " SL:", sl, " TP:", tp,
              " Risk:", InpRiskPerTrade, "% RR:", InpATRTPMulti/InpATRSLMulti);
        RecordTradingDay();
    }
    else
    {
        Print("[FTMO EA] SELL failed: ", trade.ResultRetcode(),
              " (", trade.ResultRetcodeDescription(), ")");
    }
}

//============================================================
// TRADE MANAGEMENT — Breakeven + Trailing Stop
//============================================================

void ManageOpenTrades()
{
    double atrBuf[];
    ArraySetAsSeries(atrBuf, true);
    if(CopyBuffer(h_atr, 0, 0, 3, atrBuf) < 3) return;
    double atr = atrBuf[1];

    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if(!posInfo.SelectByIndex(i)) continue;
        if(posInfo.Symbol() != _Symbol)           continue;
        if(posInfo.Magic()  != InpMagicNumber)    continue;

        ulong  ticket    = posInfo.Ticket();
        double openPx    = posInfo.PriceOpen();
        double curSL     = posInfo.StopLoss();
        double curTP     = posInfo.TakeProfit();
        ENUM_POSITION_TYPE pType = posInfo.PositionType();
        int    digits    = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
        double point     = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
        long   stopLvl   = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
        double minDist   = (stopLvl + 5) * point;

        if(pType == POSITION_TYPE_BUY)
        {
            double bid       = SymbolInfoDouble(_Symbol, SYMBOL_BID);
            double profitDst = bid - openPx;
            double beDist    = atr * InpBEAtRR * InpATRSLMulti;
            double trailDist = atr * InpTrailATRMulti;

            //--- Breakeven
            if(InpUseBreakeven && profitDst >= beDist)
            {
                double newSL = NormalizeDouble(openPx + 2 * point, digits);
                if(newSL > curSL && (bid - newSL) >= minDist)
                    trade.PositionModify(ticket, newSL, curTP);
            }

            //--- Trailing stop
            if(InpUseTrailing && profitDst >= trailDist * 1.5)
            {
                double newSL = NormalizeDouble(bid - trailDist, digits);
                if(newSL > curSL && (bid - newSL) >= minDist)
                    trade.PositionModify(ticket, newSL, curTP);
            }
        }
        else if(pType == POSITION_TYPE_SELL)
        {
            double ask       = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
            double profitDst = openPx - ask;
            double beDist    = atr * InpBEAtRR * InpATRSLMulti;
            double trailDist = atr * InpTrailATRMulti;

            //--- Breakeven
            if(InpUseBreakeven && profitDst >= beDist)
            {
                double newSL = NormalizeDouble(openPx - 2 * point, digits);
                if((curSL == 0 || newSL < curSL) && (newSL - ask) >= minDist)
                    trade.PositionModify(ticket, newSL, curTP);
            }

            //--- Trailing stop
            if(InpUseTrailing && profitDst >= trailDist * 1.5)
            {
                double newSL = NormalizeDouble(ask + trailDist, digits);
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

    int h = dt.hour;
    int dow = dt.day_of_week;

    //--- No weekends
    if(dow == 0 || dow == 6) return false;

    //--- Avoid Friday late close
    if(dow == 5 && h >= 21) return false;

    //--- Avoid Sunday/Monday gap open (first 30 min)
    if(dow == 1 && h == 0) return false;

    bool inSession = false;
    if(InpUseLondon   && h >= 8  && h < 16) inSession = true;
    if(InpUseNewYork  && h >= 13 && h < 21) inSession = true;

    return inSession;
}

//============================================================
// NEWS FILTER  (MT5 built-in economic calendar)
//============================================================

bool IsNewsTime()
{
    datetime now  = TimeCurrent();
    datetime from = now - InpNewsMinBefore * 60;
    datetime to   = now + InpNewsMinAfter  * 60;

    MqlCalendarValue values[];
    string baseCurrency  = StringSubstr(_Symbol, 0, 3);
    string quoteCurrency = StringSubstr(_Symbol, 3, 3);

    //--- Pull events for base currency
    int baseEvents = CalendarValueHistory(values, from, to, NULL, baseCurrency);
    for(int i = 0; i < baseEvents; i++)
    {
        MqlCalendarEvent ev;
        if(!CalendarEventById(values[i].event_id, ev)) continue;
        if(InpFilterHighImpact && ev.importance == CALENDAR_IMPORTANCE_HIGH)   return true;
        if(InpFilterMedImpact  && ev.importance == CALENDAR_IMPORTANCE_MODERATE) return true;
    }

    //--- Pull events for quote currency
    int quoteEvents = CalendarValueHistory(values, from, to, NULL, quoteCurrency);
    for(int i = 0; i < quoteEvents; i++)
    {
        MqlCalendarEvent ev;
        if(!CalendarEventById(values[i].event_id, ev)) continue;
        if(InpFilterHighImpact && ev.importance == CALENDAR_IMPORTANCE_HIGH)   return true;
        if(InpFilterMedImpact  && ev.importance == CALENDAR_IMPORTANCE_MODERATE) return true;
    }

    return false;
}

//============================================================
// UTILITY FUNCTIONS
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
    {
        if(posInfo.SelectByIndex(i) &&
           posInfo.Symbol() == _Symbol &&
           posInfo.Magic()  == InpMagicNumber)
        {
            trade.PositionClose(posInfo.Ticket());
        }
    }
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
//============================================================

void CreateLabel(string name, string text, int x, int y, int fontSize,
                 color clr, ENUM_ANCHOR_POINT anchor = ANCHOR_LEFT_UPPER)
{
    if(ObjectFind(0, name) < 0)
    {
        ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
        ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
        ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
        ObjectSetInteger(0, name, OBJPROP_BACK, false);
        ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
        ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
    }
    ObjectSetString (0, name, OBJPROP_TEXT, text);
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
    ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fontSize);
    ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
}

void CreateRect(string name, int x, int y, int width, int height, color clr)
{
    if(ObjectFind(0, name) < 0)
        ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);

    ObjectSetInteger(0, name, OBJPROP_CORNER,     CORNER_LEFT_UPPER);
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE,  x);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE,  y);
    ObjectSetInteger(0, name, OBJPROP_XSIZE,      width);
    ObjectSetInteger(0, name, OBJPROP_YSIZE,      height);
    ObjectSetInteger(0, name, OBJPROP_BGCOLOR,    clr);
    ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
    ObjectSetInteger(0, name, OBJPROP_BACK,       true);
    ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void BuildDashboard()
{
    CreateRect(DashPrefix+"BG", 10, 25, 310, 280, InpDashBG);
    ChartRedraw(0);
}

void UpdateDashboard()
{
    if(!InpShowDashboard) return;

    double balance  = accInfo.Balance();
    double equity   = accInfo.Equity();
    double profitPct = (balance - g_initialBalance) / g_initialBalance * 100.0;
    double dailyRef  = MathMin(g_dailyStartBalance, g_dailyStartEquity);
    double dailyLoss = (dailyRef - MathMin(balance, equity)) / g_initialBalance * 100.0;
    double totalDD   = (g_initialBalance - MathMin(balance, equity)) / g_initialBalance * 100.0;
    int    openTrades = CountOpenTrades();
    double winRate   = (g_totalTrades > 0) ? (double)g_winTrades / g_totalTrades * 100.0 : 0.0;

    color titleClr  = InpDashText;
    color valClr    = clrLightGreen;
    color warnClr   = clrOrange;
    color alertClr  = clrRed;

    int x = 15, y = 30, dy = 18;

    CreateLabel(DashPrefix+"T0", "▌ FTMO ProTrader EA",    x, y,       9, clrCyan);
    CreateLabel(DashPrefix+"T1", "━━━━━━━━━━━━━━━━━━━━━━━━━━━", x, y+dy*1, 7, clrDimGray);

    CreateLabel(DashPrefix+"L1", "Account Balance:",  x,    y+dy*2,  8, titleClr);
    CreateLabel(DashPrefix+"V1", StringFormat("$%.2f", balance), x+155, y+dy*2, 8, valClr);

    CreateLabel(DashPrefix+"L2", "Account Equity:",   x,    y+dy*3,  8, titleClr);
    CreateLabel(DashPrefix+"V2", StringFormat("$%.2f", equity),  x+155, y+dy*3, 8, valClr);

    CreateLabel(DashPrefix+"L3", "P&L (all time):",   x,    y+dy*4,  8, titleClr);
    color pnlClr = (profitPct >= 0) ? clrLightGreen : clrRed;
    CreateLabel(DashPrefix+"V3", StringFormat("%.2f%%", profitPct), x+155, y+dy*4, 8, pnlClr);

    CreateLabel(DashPrefix+"T2", "━━━━━━━━━━━━━━━━━━━━━━━━━━━", x, y+dy*5, 7, clrDimGray);
    CreateLabel(DashPrefix+"LH", "FTMO LIMITS",        x, y+dy*6,   8, clrCyan);

    color dlClr = (dailyLoss >= InpMaxDailyLoss*0.8) ? alertClr : (dailyLoss >= InpMaxDailyLoss*0.5 ? warnClr : valClr);
    CreateLabel(DashPrefix+"L4", "Daily Loss:",        x,    y+dy*7,  8, titleClr);
    CreateLabel(DashPrefix+"V4", StringFormat("%.2f%% / %.1f%%", dailyLoss, InpMaxDailyLoss), x+155, y+dy*7, 8, dlClr);

    color ddClr = (totalDD >= InpMaxTotalLoss*0.8) ? alertClr : (totalDD >= InpMaxTotalLoss*0.5 ? warnClr : valClr);
    CreateLabel(DashPrefix+"L5", "Total Drawdown:",    x,    y+dy*8,  8, titleClr);
    CreateLabel(DashPrefix+"V5", StringFormat("%.2f%% / %.1f%%", totalDD, InpMaxTotalLoss), x+155, y+dy*8, 8, ddClr);

    color ptClr = (profitPct >= InpProfitTarget) ? clrGold : valClr;
    CreateLabel(DashPrefix+"L6", "Profit Target:",     x,    y+dy*9,  8, titleClr);
    CreateLabel(DashPrefix+"V6", StringFormat("%.2f%% / %.1f%%", profitPct, InpProfitTarget), x+155, y+dy*9, 8, ptClr);

    CreateLabel(DashPrefix+"L7", "Trading Days:",      x,    y+dy*10, 8, titleClr);
    color tdClr = (g_tradingDaysCount >= InpMinTradingDays) ? clrGold : warnClr;
    CreateLabel(DashPrefix+"V7", StringFormat("%d / %d min", g_tradingDaysCount, InpMinTradingDays), x+155, y+dy*10, 8, tdClr);

    CreateLabel(DashPrefix+"T3", "━━━━━━━━━━━━━━━━━━━━━━━━━━━", x, y+dy*11, 7, clrDimGray);
    CreateLabel(DashPrefix+"LS", "STATISTICS",          x, y+dy*12,   8, clrCyan);

    CreateLabel(DashPrefix+"L8", "Open Trades:",       x,    y+dy*13, 8, titleClr);
    CreateLabel(DashPrefix+"V8", IntegerToString(openTrades), x+155, y+dy*13, 8, (openTrades>0?clrYellow:valClr));

    CreateLabel(DashPrefix+"L9", "Total Trades:",      x,    y+dy*14, 8, titleClr);
    CreateLabel(DashPrefix+"V9", IntegerToString(g_totalTrades), x+155, y+dy*14, 8, valClr);

    CreateLabel(DashPrefix+"LA", "Win Rate:",           x,    y+dy*15, 8, titleClr);
    color wrClr = (winRate >= 50) ? clrLightGreen : (winRate > 0 ? warnClr : clrGray);
    CreateLabel(DashPrefix+"VA", StringFormat("%.1f%% (%dW/%dL)", winRate, g_winTrades, g_lossTrades), x+155, y+dy*15, 8, wrClr);

    CreateLabel(DashPrefix+"T4", "━━━━━━━━━━━━━━━━━━━━━━━━━━━", x, y+dy*14+18, 7, clrDimGray);
    color statClr = (g_dailyLimitHit || g_totalLimitHit) ? alertClr :
                    (g_profitTargetHit ? clrGold : clrLightBlue);
    CreateLabel(DashPrefix+"STATUS", g_statusMsg, x, y+dy*15+18, 7, statClr);

    ChartRedraw(0);
}

void DeleteDashboard()
{
    long total = ObjectsTotal(0, 0, -1);
    for(long i = total - 1; i >= 0; i--)
    {
        string name = ObjectName(0, (int)i, 0, -1);
        if(StringFind(name, DashPrefix) == 0)
            ObjectDelete(0, name);
    }
    ChartRedraw(0);
}
//+------------------------------------------------------------------+
