//+------------------------------------------------------------------+
//|                         ProTrader_Core.mqh                       |
//|       Shared Engine — FTMO ProTrader EA & MAX ProTrader EA       |
//|                                                                  |
//|  Textually included AFTER all `input` declarations in each       |
//|  wrapper .mq5 file. Contains all event handlers, indicator       |
//|  logic, trading logic, risk management, and dashboard.           |
//|                                                                  |
//|  Version: v5.00                                                  |
//|  No `input` declarations here — all inputs live in the wrapper.  |
//+------------------------------------------------------------------+
#ifndef PROTRADER_CORE_MQH
#define PROTRADER_CORE_MQH

#include "ProTrader_PIDs.mqh"
#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>
#include <Trade\OrderInfo.mqh>

//+------------------------------------------------------------------+
//| Signal enumeration                                               |
//+------------------------------------------------------------------+
enum ENUM_SIGNAL
{
    SIGNAL_NONE,
    SIGNAL_BUY,
    SIGNAL_SELL
};

//+------------------------------------------------------------------+
//| Indicator snapshot structure (populated once per bar)            |
//+------------------------------------------------------------------+
struct IndicatorValues
{
    // Main-TF values (index 0 = current closed bar, 1 = prior)
    double fastEMA[2];
    double slowEMA[2];
    double trendEMA[2];
    double rsi[2];
    double atr[2];
    double macdMain[2];
    double macdSignal[2];

    // Trend-TF values (same indexing)
    double fastEMA_TF[2];
    double slowEMA_TF[2];
    double trendEMA_TF[2];
    double macdMain_TF[2];
    double macdSignal_TF[2];
};

//+------------------------------------------------------------------+
//| Trade objects                                                    |
//+------------------------------------------------------------------+
CTrade          trade;
CPositionInfo   posInfo;
CAccountInfo    accInfo;
COrderInfo      ordInfo;

//+------------------------------------------------------------------+
//| FTMO / risk-management state                                     |
//+------------------------------------------------------------------+
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

//+------------------------------------------------------------------+
//| Per-tick cache (refreshed at top of Core_TickBody)               |
//+------------------------------------------------------------------+
double g_balance;
double g_equity;
int    g_openTrades;

//+------------------------------------------------------------------+
//| Symbol constants (set once in OnInit, never change)              |
//+------------------------------------------------------------------+
int    g_digits;
double g_point;
long   g_stopLvl;
double g_minLot;
double g_maxLot;
double g_lotStep;

//+------------------------------------------------------------------+
//| Pre-computed constants                                           |
//+------------------------------------------------------------------+
double g_rrRatio;        // InpATRTPMulti / InpATRSLMulti
double g_beDist_factor;  // InpBEAtRR * InpATRSLMulti (for SL calc)

//+------------------------------------------------------------------+
//| Dashboard rate-limiter                                           |
//+------------------------------------------------------------------+
uint g_lastDashMs;

//+------------------------------------------------------------------+
//| Bar-open detection                                               |
//+------------------------------------------------------------------+
datetime g_lastBar;

//+------------------------------------------------------------------+
//| Indicator handles — Main TF                                      |
//+------------------------------------------------------------------+
int h_fastEMA;
int h_slowEMA;
int h_trendEMA;
int h_rsi;
int h_atr;
int h_macd;

//+------------------------------------------------------------------+
//| Indicator handles — Trend TF                                     |
//+------------------------------------------------------------------+
int h_fastEMA_TF;
int h_slowEMA_TF;
int h_trendEMA_TF;
int h_macd_TF;

//+------------------------------------------------------------------+
//| GlobalVariable prefix (magic + symbol, no cross-EA collision)    |
//+------------------------------------------------------------------+
string g_gv;         // e.g. "PT_202401_EURUSD_"

//+------------------------------------------------------------------+
//| Dashboard object-name prefix (magic-keyed)                       |
//+------------------------------------------------------------------+
string DashPrefix;   // e.g. "PTD_202401_"

//+------------------------------------------------------------------+
//| Closed-trade CSV log file name (magic + symbol keyed)            |
//| Feeds the Monte Carlo validator (FTMO_Optimizer.mq5).           |
//+------------------------------------------------------------------+
string g_tradeLog;   // e.g. "PT_202401_EURUSD_trades.csv"
int    g_logTradeNo; // running closed-trade counter for the CSV row index

//+------------------------------------------------------------------+
//| TradeLog_Init — (re)create the CSV with a header row.            |
//| Called once in OnInit when InpLogTrades is enabled. Appends if   |
//| the file already exists so a mid-challenge restart keeps history.|
//+------------------------------------------------------------------+
void TradeLog_Init()
{
    if(!InpLogTrades) return;

    g_tradeLog  = StringFormat("PT_%d_%s_trades.csv", InpMagicNumber, _Symbol);
    g_logTradeNo = 0;

    //--- If the file already exists, count its data rows so the index
    //    continues seamlessly; otherwise write a fresh header.
    if(FileIsExist(g_tradeLog))
    {
        int rh = FileOpen(g_tradeLog, FILE_READ | FILE_CSV | FILE_ANSI, ',');
        if(rh != INVALID_HANDLE)
        {
            while(!FileIsEnding(rh))
            {
                string line = FileReadString(rh);
                if(StringLen(line) > 0 && StringFind(line, "trade_no") < 0)
                    g_logTradeNo++;
                // advance to end of row
                while(!FileIsLineEnding(rh) && !FileIsEnding(rh)) FileReadString(rh);
            }
            FileClose(rh);
        }
        return;  // keep existing history, append-only from here
    }

    int wh = FileOpen(g_tradeLog, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
    if(wh == INVALID_HANDLE)
    {
        Print("ProTrader v5.00: WARNING — could not create trade log ", g_tradeLog,
              " err=", GetLastError());
        return;
    }
    FileWrite(wh, "trade_no", "close_time", "symbol", "profit",
                  "balance", "equity", "win", "effective_risk");
    FileClose(wh);
    Print("ProTrader v5.00: trade log → MQL5\\Files\\", g_tradeLog);
}

//+------------------------------------------------------------------+
//| TradeLog_Append — append one closed-trade row. Open in READ_WRITE|
//| and seek to the end so existing rows are preserved.              |
//+------------------------------------------------------------------+
void TradeLog_Append(double profit, double balance, double equity,
                     bool isWin, double effRisk)
{
    if(!InpLogTrades) return;
    if(StringLen(g_tradeLog) == 0) return;

    int h = FileOpen(g_tradeLog, FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
    if(h == INVALID_HANDLE)
    {
        Print("ProTrader v5.00: WARNING — trade log append failed err=", GetLastError());
        return;
    }
    FileSeek(h, 0, SEEK_END);
    g_logTradeNo++;
    FileWrite(h,
              g_logTradeNo,
              TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS),
              _Symbol,
              DoubleToString(profit,  2),
              DoubleToString(balance, 2),
              DoubleToString(equity,  2),
              isWin ? 1 : 0,
              DoubleToString(effRisk, 4));
    FileClose(h);
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 1 — INPUT VALIDATION
//===================================================================
//+------------------------------------------------------------------+

bool ValidateInputs()
{
    bool ok = true;

    //--- Mode-dependent risk limits
    if(InpFTMOMode)
    {
        if(InpMaxDailyLoss >= 5.0)
        {
            Print("ValidateInputs: FTMO mode requires InpMaxDailyLoss < 5.0 (got ",
                  DoubleToString(InpMaxDailyLoss, 2), ")");
            ok = false;
        }
        if(InpMaxTotalLoss >= 10.0)
        {
            Print("ValidateInputs: FTMO mode requires InpMaxTotalLoss < 10.0 (got ",
                  DoubleToString(InpMaxTotalLoss, 2), ")");
            ok = false;
        }
        if(InpPIDEnabled && InpPIDMaxRisk > 5.0)
        {
            Print("ValidateInputs: FTMO mode requires InpPIDMaxRisk <= 5.0 (got ",
                  DoubleToString(InpPIDMaxRisk, 2), ")");
            ok = false;
        }
    }
    else
    {
        // MAX mode: InpMaxTotalLoss must be positive
        if(InpMaxTotalLoss <= 0.0)
        {
            Print("ValidateInputs: MAX mode requires InpMaxTotalLoss > 0 (got ",
                  DoubleToString(InpMaxTotalLoss, 2), ")");
            ok = false;
        }
    }

    //--- Base risk
    if(InpRiskPerTrade <= 0.0)
    {
        Print("ValidateInputs: InpRiskPerTrade must be > 0 (got ",
              DoubleToString(InpRiskPerTrade, 4), ")");
        ok = false;
    }

    //--- Daily/total loss basic sanity (positive required in both modes)
    if(InpMaxDailyLoss <= 0.0)
    {
        Print("ValidateInputs: InpMaxDailyLoss must be > 0 (got ",
              DoubleToString(InpMaxDailyLoss, 2), ")");
        ok = false;
    }

    //--- EMA ordering
    if(InpFastEMA >= InpSlowEMA)
    {
        Print("ValidateInputs: InpFastEMA (", InpFastEMA,
              ") must be < InpSlowEMA (", InpSlowEMA, ")");
        ok = false;
    }
    if(InpSlowEMA >= InpTrendEMA)
    {
        Print("ValidateInputs: InpSlowEMA (", InpSlowEMA,
              ") must be < InpTrendEMA (", InpTrendEMA, ")");
        ok = false;
    }

    //--- ATR multiplier sanity
    if(InpATRSLMulti <= 0.0)
    {
        Print("ValidateInputs: InpATRSLMulti must be > 0 (got ",
              DoubleToString(InpATRSLMulti, 4), ")");
        ok = false;
    }
    if(InpATRTPMulti <= 0.0)
    {
        Print("ValidateInputs: InpATRTPMulti must be > 0 (got ",
              DoubleToString(InpATRTPMulti, 4), ")");
        ok = false;
    }
    if(InpATRTPMulti <= InpATRSLMulti)
    {
        Print("ValidateInputs: InpATRTPMulti (", DoubleToString(InpATRTPMulti, 4),
              ") must be > InpATRSLMulti (", DoubleToString(InpATRSLMulti, 4), ")");
        ok = false;
    }

    //--- RSI threshold ordering
    if(InpRSIOverbought <= InpRSIOversold)
    {
        Print("ValidateInputs: InpRSIOverbought (", InpRSIOverbought,
              ") must be > InpRSIOversold (", InpRSIOversold, ")");
        ok = false;
    }

    //--- Periods
    if(InpFastEMA < 1 || InpSlowEMA < 1 || InpTrendEMA < 1 || InpRSIPeriod < 2 ||
       InpATRPeriod < 1 || InpMACDFast < 1 || InpMACDSlow < 1 || InpMACDSignal < 1)
    {
        Print("ValidateInputs: One or more indicator periods are invalid (< 1)");
        ok = false;
    }
    if(InpMACDFast >= InpMACDSlow)
    {
        Print("ValidateInputs: InpMACDFast (", InpMACDFast,
              ") must be < InpMACDSlow (", InpMACDSlow, ")");
        ok = false;
    }

    //--- Trade management
    if(InpMaxTrades < 1)
    {
        Print("ValidateInputs: InpMaxTrades must be >= 1 (got ", InpMaxTrades, ")");
        ok = false;
    }
    if(InpMaxSpreadPoints <= 0)
    {
        Print("ValidateInputs: InpMaxSpreadPoints must be > 0 (got ", InpMaxSpreadPoints, ")");
        ok = false;
    }
    if(InpMinSignals < 1 || InpMinSignals > 5)
    {
        Print("ValidateInputs: InpMinSignals must be 1-5 (got ", InpMinSignals, ")");
        ok = false;
    }

    //--- PID bounds
    if(InpPIDEnabled)
    {
        if(InpPIDMinRisk <= 0.0)
        {
            Print("ValidateInputs: InpPIDMinRisk must be > 0 (got ",
                  DoubleToString(InpPIDMinRisk, 4), ")");
            ok = false;
        }
        if(InpPIDMaxRisk <= InpPIDMinRisk)
        {
            Print("ValidateInputs: InpPIDMaxRisk (", DoubleToString(InpPIDMaxRisk, 4),
                  ") must be > InpPIDMinRisk (", DoubleToString(InpPIDMinRisk, 4), ")");
            ok = false;
        }
        if(InpPIDMaxStep <= 0.0)
        {
            Print("ValidateInputs: InpPIDMaxStep must be > 0 (got ",
                  DoubleToString(InpPIDMaxStep, 4), ")");
            ok = false;
        }
    }

    //--- Breakeven / trailing sanity
    if(InpBEAtRR <= 0.0)
    {
        Print("ValidateInputs: InpBEAtRR must be > 0 (got ",
              DoubleToString(InpBEAtRR, 4), ")");
        ok = false;
    }
    if(InpTrailATRMulti <= 0.0)
    {
        Print("ValidateInputs: InpTrailATRMulti must be > 0 (got ",
              DoubleToString(InpTrailATRMulti, 4), ")");
        ok = false;
    }

    return ok;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 2 — TRADE COUNTING & HOUSE-KEEPING
//===================================================================
//+------------------------------------------------------------------+

//--------------------------------------------------------------------
// CountOpenTrades — count open positions belonging to this EA
//--------------------------------------------------------------------
int CountOpenTrades()
{
    int count = 0;
    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if(posInfo.SelectByIndex(i))
        {
            if(posInfo.Symbol() == _Symbol && posInfo.Magic() == (ulong)InpMagicNumber)
                count++;
        }
    }
    return count;
}

//--------------------------------------------------------------------
// CloseAllTrades — immediately close all positions for this EA
//--------------------------------------------------------------------
void CloseAllTrades()
{
    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if(posInfo.SelectByIndex(i))
        {
            if(posInfo.Symbol() == _Symbol && posInfo.Magic() == (ulong)InpMagicNumber)
            {
                if(!trade.PositionClose(posInfo.Ticket()))
                    Print("CloseAllTrades: failed to close #", posInfo.Ticket(),
                          " err=", GetLastError());
            }
        }
    }
}

//--------------------------------------------------------------------
// RecordTradingDay — called once per new calendar day to count days
//--------------------------------------------------------------------
void RecordTradingDay()
{
    datetime today = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));
    if(today != g_lastTradedDay)
    {
        g_tradingDaysCount++;
        g_lastTradedDay = today;
    }
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 3 — RISK MANAGEMENT UPDATE (per-tick)
//===================================================================
//+------------------------------------------------------------------+

void UpdateRiskManagement()
{
    datetime now = TimeCurrent();

    //------------------------------------------------------------------
    // Day rollover detection
    //------------------------------------------------------------------
    MqlDateTime dtNow, dtLast;
    TimeToStruct(now, dtNow);
    TimeToStruct(g_lastDayTime, dtLast);

    bool newDay = (dtNow.year != dtLast.year ||
                   dtNow.mon  != dtLast.mon  ||
                   dtNow.day  != dtLast.day);

    if(newDay)
    {
        RecordTradingDay();

        // Snapshot day-start values
        g_dailyStartBalance = g_balance;
        g_dailyStartEquity  = g_equity;
        g_lastDayTime       = now;

        // Persist for restart recovery
        GlobalVariableSet(g_gv + "DayBal",  g_dailyStartBalance);
        GlobalVariableSet(g_gv + "DayTime", (double)g_lastDayTime);

        // Reset daily halt flag so a new day can trade again
        // (total-halt and profit-target are permanent for the challenge run)
        g_dailyLimitHit = false;

        // Roll PID controllers
        PID_DailyReset();

        Print("ProTrader v5.00 | Day rollover — balance=", DoubleToString(g_balance, 2),
              " equity=", DoubleToString(g_equity, 2),
              " tradingDays=", g_tradingDaysCount);
    }

    //------------------------------------------------------------------
    // Daily loss limit check (FTMO: loss from daily start reference)
    //------------------------------------------------------------------
    if(InpEnforceDailyLimit && !g_dailyLimitHit)
    {
        double dailyRef    = MathMin(g_dailyStartBalance, g_dailyStartEquity);
        double worstEquity = MathMin(g_balance, g_equity);
        double lossPct     = 0.0;
        if(g_initialBalance > 0.0)
            lossPct = (dailyRef - worstEquity) / g_initialBalance * 100.0;

        if(lossPct >= InpMaxDailyLoss)
        {
            g_dailyLimitHit = true;
            g_statusMsg     = StringFormat("DAILY LIMIT HIT: %.2f%% loss", lossPct);
            Print("ProTrader v5.00 | ", g_statusMsg, " — halting trading");
            CloseAllTrades();
        }
    }

    //------------------------------------------------------------------
    // Total drawdown check (from initial balance)
    //------------------------------------------------------------------
    if(InpEnforceTotalLimit && !g_totalLimitHit)
    {
        double worstEquity = MathMin(g_balance, g_equity);
        double totalDD     = 0.0;
        if(g_initialBalance > 0.0)
            totalDD = (g_initialBalance - worstEquity) / g_initialBalance * 100.0;

        if(totalDD >= InpMaxTotalLoss)
        {
            g_totalLimitHit = true;
            g_statusMsg     = StringFormat("TOTAL DD LIMIT HIT: %.2f%% drawdown", totalDD);
            Print("ProTrader v5.00 | ", g_statusMsg, " — halting trading permanently");
            GlobalVariableSet(g_gv + "TotalHalt", 1.0);
            CloseAllTrades();
        }
    }

    //------------------------------------------------------------------
    // Profit target check (on realised balance)
    //------------------------------------------------------------------
    if(InpEnforceProfitStop && !g_profitTargetHit)
    {
        double profitPct = 0.0;
        if(g_initialBalance > 0.0)
            profitPct = (g_balance - g_initialBalance) / g_initialBalance * 100.0;

        if(profitPct >= InpProfitTarget)
        {
            g_profitTargetHit = true;
            g_statusMsg       = StringFormat("PROFIT TARGET HIT: %.2f%%", profitPct);
            Print("ProTrader v5.00 | ", g_statusMsg, " — stopping EA");
            GlobalVariableSet(g_gv + "ProfitHit", 1.0);
            // Do NOT close trades; let them complete; just stop new entries
        }
    }
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 4 — INDICATOR LOADING
//===================================================================
//+------------------------------------------------------------------+

//--- Copy 2 confirmed bars (shift 1 + 2) into a fixed 2-slot struct member in
//    series order: dest[0] = shift 1 (newest confirmed), dest[1] = shift 2.
//    A dynamic temp is used because ArraySetAsSeries can't apply to the fixed
//    struct arrays directly.
bool CopyConfirmed2(int handle, int buffer, double &dest[])
{
    double tmp[];
    ArraySetAsSeries(tmp, true);
    if(CopyBuffer(handle, buffer, 1, 2, tmp) < 2) return false;
    dest[0] = tmp[0];
    dest[1] = tmp[1];
    return true;
}

bool LoadIndicators(IndicatorValues &iv)
{
    // Main TF
    if(!CopyConfirmed2(h_fastEMA,  0, iv.fastEMA))    return false;
    if(!CopyConfirmed2(h_slowEMA,  0, iv.slowEMA))    return false;
    if(!CopyConfirmed2(h_trendEMA, 0, iv.trendEMA))   return false;
    if(!CopyConfirmed2(h_rsi,      0, iv.rsi))        return false;
    if(!CopyConfirmed2(h_atr,      0, iv.atr))        return false;
    if(!CopyConfirmed2(h_macd,     0, iv.macdMain))   return false;
    if(!CopyConfirmed2(h_macd,     1, iv.macdSignal)) return false;

    // Trend TF
    if(!CopyConfirmed2(h_fastEMA_TF,  0, iv.fastEMA_TF))    return false;
    if(!CopyConfirmed2(h_slowEMA_TF,  0, iv.slowEMA_TF))    return false;
    if(!CopyConfirmed2(h_trendEMA_TF, 0, iv.trendEMA_TF))   return false;
    if(!CopyConfirmed2(h_macd_TF,     0, iv.macdMain_TF))   return false;
    if(!CopyConfirmed2(h_macd_TF,     1, iv.macdSignal_TF)) return false;

    //--- NaN / infinity guards on the values we will actually trade on
    if(!MathIsValidNumber(iv.fastEMA[0])  || !MathIsValidNumber(iv.slowEMA[0])   ||
       !MathIsValidNumber(iv.trendEMA[0]) || !MathIsValidNumber(iv.rsi[0])        ||
       !MathIsValidNumber(iv.atr[0])      || !MathIsValidNumber(iv.macdMain[0])   ||
       !MathIsValidNumber(iv.fastEMA_TF[0]) || !MathIsValidNumber(iv.slowEMA_TF[0]) ||
       !MathIsValidNumber(iv.trendEMA_TF[0]))
        return false;

    return true;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 5 — SIGNAL GENERATION (InpMinSignals-of-5 confluence)
//===================================================================
//+------------------------------------------------------------------+

ENUM_SIGNAL GetSignal(const IndicatorValues &iv)
{
    //--- Individual condition evaluation at bar index [0] (last closed bar,
    //    copied with start=1 so [0] is the freshest completed candle).

    // 1. EMA short-term cross on main TF:
    //    Buy  = fastEMA above slowEMA (and crossed from below on prior bar)
    //    We check cross: fastEMA[0] > slowEMA[0] and fastEMA[1] <= slowEMA[1]
    bool emaCrossUp   = (iv.fastEMA[0] > iv.slowEMA[0]) &&
                        (iv.fastEMA[1] <= iv.slowEMA[1]);
    bool emaCrossDown = (iv.fastEMA[0] < iv.slowEMA[0]) &&
                        (iv.fastEMA[1] >= iv.slowEMA[1]);

    // 2. Price side of Trend EMA on main TF (trend filter layer 1):
    //    Proxy via fastEMA above/below trendEMA[0]
    bool aboveTrend   = (iv.fastEMA[0] > iv.trendEMA[0]);
    bool belowTrend   = (iv.fastEMA[0] < iv.trendEMA[0]);

    // 3. MACD main line cross signal on main TF:
    bool macdBull     = (iv.macdMain[0] > iv.macdSignal[0]) &&
                        (iv.macdMain[1] <= iv.macdSignal[1]);
    bool macdBear     = (iv.macdMain[0] < iv.macdSignal[0]) &&
                        (iv.macdMain[1] >= iv.macdSignal[1]);

    // 4. RSI in favourable zone (not counter-momentum):
    bool rsiOK_buy    = (iv.rsi[0] < InpRSIOverbought);  // not overbought
    bool rsiOK_sell   = (iv.rsi[0] > InpRSIOversold);    // not oversold

    // 5. Higher-timeframe trend alignment — fastEMA vs slowEMA on Trend TF,
    //    combined with Trend-TF MACD alignment:
    bool htfBull      = (iv.fastEMA_TF[0] > iv.slowEMA_TF[0]) &&
                        (iv.fastEMA_TF[0] > iv.trendEMA_TF[0]) &&
                        (iv.macdMain_TF[0] >= iv.macdSignal_TF[0]);
    bool htfBear      = (iv.fastEMA_TF[0] < iv.slowEMA_TF[0]) &&
                        (iv.fastEMA_TF[0] < iv.trendEMA_TF[0]) &&
                        (iv.macdMain_TF[0] <= iv.macdSignal_TF[0]);

    //--- Score 4-of-5 confluence (each condition = 1 point)
    int buyScore  = (emaCrossUp  ? 1 : 0) + (aboveTrend ? 1 : 0) +
                    (macdBull    ? 1 : 0) + (rsiOK_buy  ? 1 : 0) +
                    (htfBull     ? 1 : 0);

    int sellScore = (emaCrossDown ? 1 : 0) + (belowTrend ? 1 : 0) +
                    (macdBear     ? 1 : 0) + (rsiOK_sell ? 1 : 0) +
                    (htfBear      ? 1 : 0);

    if(buyScore  >= InpMinSignals) return SIGNAL_BUY;
    if(sellScore >= InpMinSignals) return SIGNAL_SELL;

    return SIGNAL_NONE;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 6 — LOT SIZE CALCULATION
//===================================================================
//+------------------------------------------------------------------+

//--------------------------------------------------------------------
// CalcLotSize — base overload using fixed risk (no ATR provided)
//--------------------------------------------------------------------
double CalcLotSize(double slPoints)
{
    return CalcLotSize(slPoints, 0.0);
}

//--------------------------------------------------------------------
// CalcLotSize — full overload; atrValue feeds PID_GetEffectiveRisk
//--------------------------------------------------------------------
double CalcLotSize(double slPoints, double atrValue)
{
    if(slPoints <= 0.0) return 0.0;

    double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
    double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);

    if(tickSize <= 0.0 || tickValue <= 0.0) return 0.0;

    //--- Determine effective risk %
    double effRisk;
    if(InpPIDEnabled && atrValue > 0.0 && MathIsValidNumber(atrValue))
        effRisk = PID_GetEffectiveRisk(g_equity, g_initialBalance, atrValue);
    else
        effRisk = InpRiskPerTrade;

    // Guard: must be finite and positive
    if(!MathIsValidNumber(effRisk) || effRisk <= 0.0)
        effRisk = InpRiskPerTrade;

    double riskAmount      = g_balance * effRisk / 100.0;
    double valuePerPoint   = (slPoints / tickSize) * tickValue;

    if(valuePerPoint <= 0.0) return 0.0;

    double lots = riskAmount / valuePerPoint;

    // Floor to lot step (never round up — that would exceed risk)
    if(g_lotStep > 0.0)
        lots = MathFloor(lots / g_lotStep) * g_lotStep;

    // Clamp to broker limits
    lots = MathMax(g_minLot, MathMin(g_maxLot, lots));

    //--- Over-risk guard: if min-lot would risk more than 1.5x target, skip
    double actualRisk = lots * valuePerPoint;
    if(actualRisk > riskAmount * 1.5)
        return 0.0;

    // Final validity check
    if(!MathIsValidNumber(lots) || lots <= 0.0)
        return 0.0;

    return lots;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 7 — SPREAD FILTER
//===================================================================
//+------------------------------------------------------------------+

bool IsSpreadOK()
{
    long currentSpread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
    int  threshold     = (InpPIDEnabled && InpSPIDEnabled)
                         ? SPID_MaxSpread()
                         : InpMaxSpreadPoints;
    return (currentSpread <= (long)threshold);
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 8 — ORDER EXECUTION
//===================================================================
//+------------------------------------------------------------------+

//--------------------------------------------------------------------
// ExecuteBuy
//--------------------------------------------------------------------
void ExecuteBuy(const double &atr[])
{
    if(!IsSpreadOK())
    {
        if(MQLInfoInteger(MQL_TESTER) == 0)  // reduce noise in backtests
            Print("ExecuteBuy: spread too wide — skipping");
        return;
    }

    double atrVal = atr[1];
    if(atrVal <= 0.0 || !MathIsValidNumber(atrVal))
    {
        Print("ExecuteBuy: invalid ATR value (", atrVal, ") — skipping");
        return;
    }

    double ask     = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    double slDist  = atrVal * InpATRSLMulti;
    double tpDist  = atrVal * InpATRTPMulti;

    double sl      = NormalizeDouble(ask - slDist, g_digits);
    double tp      = NormalizeDouble(ask + tpDist, g_digits);

    // Enforce minimum stop distance
    double minStop = g_stopLvl * g_point;
    if(ask - sl < minStop) sl = NormalizeDouble(ask - minStop, g_digits);
    if(tp - ask < minStop) tp = NormalizeDouble(ask + minStop, g_digits);

    double slPoints = ask - sl;
    if(slPoints <= 0.0)
    {
        Print("ExecuteBuy: computed SL distance <= 0 — skipping");
        return;
    }

    double lots = CalcLotSize(slPoints, atrVal);
    if(lots <= 0.0)
    {
        Print("ExecuteBuy: lot size is 0 (risk guard or bad params) — skipping");
        return;
    }

    trade.SetExpertMagicNumber((ulong)InpMagicNumber);
    if(!trade.Buy(lots, _Symbol, ask, sl, tp, "ProTrader v5.00 BUY"))
        Print("ExecuteBuy: order failed, error=", GetLastError());
    else
        Print("ExecuteBuy: lots=", lots, " sl=", sl, " tp=", tp,
              " spread=", SymbolInfoInteger(_Symbol, SYMBOL_SPREAD));
}

//--------------------------------------------------------------------
// ExecuteSell
//--------------------------------------------------------------------
void ExecuteSell(const double &atr[])
{
    if(!IsSpreadOK())
    {
        if(MQLInfoInteger(MQL_TESTER) == 0)
            Print("ExecuteSell: spread too wide — skipping");
        return;
    }

    double atrVal = atr[1];
    if(atrVal <= 0.0 || !MathIsValidNumber(atrVal))
    {
        Print("ExecuteSell: invalid ATR value (", atrVal, ") — skipping");
        return;
    }

    double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    double slDist = atrVal * InpATRSLMulti;
    double tpDist = atrVal * InpATRTPMulti;

    double sl     = NormalizeDouble(bid + slDist, g_digits);
    double tp     = NormalizeDouble(bid - tpDist, g_digits);

    double minStop = g_stopLvl * g_point;
    if(sl - bid < minStop) sl = NormalizeDouble(bid + minStop, g_digits);
    if(bid - tp < minStop) tp = NormalizeDouble(bid - minStop, g_digits);

    double slPoints = sl - bid;
    if(slPoints <= 0.0)
    {
        Print("ExecuteSell: computed SL distance <= 0 — skipping");
        return;
    }

    double lots = CalcLotSize(slPoints, atrVal);
    if(lots <= 0.0)
    {
        Print("ExecuteSell: lot size is 0 (risk guard or bad params) — skipping");
        return;
    }

    trade.SetExpertMagicNumber((ulong)InpMagicNumber);
    if(!trade.Sell(lots, _Symbol, bid, sl, tp, "ProTrader v5.00 SELL"))
        Print("ExecuteSell: order failed, error=", GetLastError());
    else
        Print("ExecuteSell: lots=", lots, " sl=", sl, " tp=", tp,
              " spread=", SymbolInfoInteger(_Symbol, SYMBOL_SPREAD));
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 9 — OPEN POSITION MANAGEMENT (breakeven + trailing)
//===================================================================
//+------------------------------------------------------------------+

void ManageOpenTrades()
{
    //--- Fetch current ATR for position management (dynamic array → series-safe)
    double atrBuf[];
    ArraySetAsSeries(atrBuf, true);
    if(CopyBuffer(h_atr, 0, 1, 2, atrBuf) < 2) return;

    double atrNow = atrBuf[0];
    if(atrNow <= 0.0 || !MathIsValidNumber(atrNow)) return;

    for(int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if(!posInfo.SelectByIndex(i)) continue;
        if(posInfo.Symbol() != _Symbol)              continue;
        if(posInfo.Magic()  != (ulong)InpMagicNumber) continue;

        ulong  ticket    = posInfo.Ticket();
        double openPrice = posInfo.PriceOpen();
        double curSL     = posInfo.StopLoss();
        double curTP     = posInfo.TakeProfit();
        ENUM_POSITION_TYPE pType = posInfo.PositionType();

        double slDist    = atrNow * InpATRSLMulti;
        double beDist    = slDist * InpBEAtRR;   // distance to move SL to breakeven

        //--- Validity guards
        if(!MathIsValidNumber(openPrice) || !MathIsValidNumber(slDist) ||
           !MathIsValidNumber(beDist)    || slDist <= 0.0)
            continue;

        double newSL = curSL;

        if(pType == POSITION_TYPE_BUY)
        {
            double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

            //--- Breakeven: move SL to open price when price has moved beDist above entry
            if(InpUseBreakeven && curSL < openPrice && (bid - openPrice) >= beDist)
            {
                newSL = NormalizeDouble(openPrice, g_digits);
            }

            //--- Trailing stop: keep SL a trailing distance below current bid
            if(InpUseTrailing)
            {
                double trailDist = atrNow * InpTrailATRMulti;
                double trailSL   = NormalizeDouble(bid - trailDist, g_digits);
                if(trailSL > newSL)
                    newSL = trailSL;
            }

            // Only modify if SL actually improves (moves up)
            if(newSL > curSL && MathIsValidNumber(newSL))
            {
                if(!trade.PositionModify(ticket, newSL, curTP))
                    Print("ManageOpenTrades: modify BUY #", ticket,
                          " SL->", newSL, " err=", GetLastError());
            }
        }
        else if(pType == POSITION_TYPE_SELL)
        {
            double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

            //--- Breakeven: move SL to open price when price has moved beDist below entry
            if(InpUseBreakeven && (curSL > openPrice || curSL == 0.0) == false)
            {
                // curSL above openPrice means no BE yet for sell
                if(curSL > openPrice && (openPrice - ask) >= beDist)
                    newSL = NormalizeDouble(openPrice, g_digits);
            }
            // Simpler re-formulation that avoids the double-negative above:
            if(InpUseBreakeven && curSL > openPrice && (openPrice - ask) >= beDist)
            {
                newSL = NormalizeDouble(openPrice, g_digits);
            }

            //--- Trailing stop: keep SL a trailing distance above current ask
            if(InpUseTrailing)
            {
                double trailDist = atrNow * InpTrailATRMulti;
                double trailSL   = NormalizeDouble(ask + trailDist, g_digits);
                if(curSL == 0.0 || trailSL < newSL)
                    newSL = trailSL;
            }

            // Only modify if SL actually improves (moves down for sell)
            if((curSL == 0.0 || newSL < curSL) && MathIsValidNumber(newSL) && newSL > 0.0)
            {
                if(!trade.PositionModify(ticket, newSL, curTP))
                    Print("ManageOpenTrades: modify SELL #", ticket,
                          " SL->", newSL, " err=", GetLastError());
            }
        }
    }
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 10 — SESSION FILTER
//===================================================================
//+------------------------------------------------------------------+

bool IsInTradingSession()
{
    datetime now = TimeCurrent();
    MqlDateTime dt;
    TimeToStruct(now, dt);

    int dow  = dt.day_of_week;
    int hour = dt.hour;

    // Adjust for broker GMT offset
    int gmtHour = (hour - InpGMTOffset + 24) % 24;
    int gmtDow  = dow;

    // Simple weekend guard (Saturday=6, Sunday=0 in MQL DayOfWeek)
    if(gmtDow == 0 || gmtDow == 6) return false;

    // Friday 21:00 GMT onwards — close ahead of weekend
    if(gmtDow == 5 && gmtHour >= 21) return false;

    // Monday gap protection — skip first hour after Sunday open
    if(gmtDow == 1 && gmtHour == 0)  return false;

    bool inSession = false;

    // London session: 08:00 – 16:00 GMT
    if(InpUseLondon && gmtHour >= 8 && gmtHour < 16)
        inSession = true;

    // New York session: 13:00 – 21:00 GMT
    if(InpUseNewYork && gmtHour >= 13 && gmtHour < 21)
        inSession = true;

    return inSession;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 11 — NEWS FILTER
//===================================================================
//+------------------------------------------------------------------+

//--- Scan the calendar for one currency; returns true if a filtered event
//    falls inside the [before, after] window around now.
bool NewsHitForCurrency(const string ccy, datetime now,
                        datetime lookBack, datetime lookAhead)
{
    MqlCalendarValue values[];
    // CalendarValueHistory filters by currency directly — no per-event
    // country/currency lookup needed (MqlCalendarEvent has no currency field).
    int count = CalendarValueHistory(values, lookBack, lookAhead, NULL, ccy);
    if(count <= 0) return false;

    int limit = (count < 500) ? count : 500;  // bound runaway on corrupt data
    for(int i = 0; i < limit; i++)
    {
        MqlCalendarEvent ev;
        if(!CalendarEventById(values[i].event_id, ev)) continue;

        bool relevant = false;
        if(InpFilterHighImpact && ev.importance == CALENDAR_IMPORTANCE_HIGH)
            relevant = true;
        if(InpFilterMedImpact  && ev.importance == CALENDAR_IMPORTANCE_MODERATE)
            relevant = true;
        if(!relevant) continue;

        long diff = (long)(now - values[i].time);  // seconds; <0 = future event
        if(diff < 0  && MathAbs(diff) <= (long)InpNewsMinBefore * 60) return true;
        if(diff >= 0 && diff          <= (long)InpNewsMinAfter  * 60) return true;
    }
    return false;
}

bool IsNewsTime()
{
    if(!InpUseNewsFilter) return false;

    datetime now       = TimeCurrent();
    datetime lookBack  = now - (datetime)(InpNewsMinBefore + 60) * 60;
    datetime lookAhead = now + (datetime)(InpNewsMinAfter  + 60) * 60;

    // Block on events for either leg of the pair (e.g. EUR or USD on EURUSD)
    string baseCcy  = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_BASE);
    string quoteCcy = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_PROFIT);

    if(NewsHitForCurrency(baseCcy,  now, lookBack, lookAhead)) return true;
    if(NewsHitForCurrency(quoteCcy, now, lookBack, lookAhead)) return true;
    return false;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 12 — DASHBOARD
//===================================================================
//+------------------------------------------------------------------+

// Dashboard geometry constants
#define DASH_X          10
#define DASH_Y          20
#define DASH_W         260
#define DASH_H         340
#define DASH_LINE_H     18
#define DASH_PAD_X      8
#define DASH_PAD_Y      6
#define DASH_FONT_SZ    8

//--------------------------------------------------------------------
// Internal helper — create or update a text label on the chart
//--------------------------------------------------------------------
void DashLabel(string name, string text, int x, int y,
               color clr, int fontSize = DASH_FONT_SZ,
               string font = "Consolas")
{
    if(ObjectFind(0, name) < 0)
    {
        ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
        ObjectSetInteger(0, name, OBJPROP_CORNER,    CORNER_LEFT_UPPER);
        ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
        ObjectSetInteger(0, name, OBJPROP_BACK,       false);
    }
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
    ObjectSetInteger(0, name, OBJPROP_COLOR,     clr);
    ObjectSetInteger(0, name, OBJPROP_FONTSIZE,  fontSize);
    ObjectSetString (0, name, OBJPROP_FONT,      font);
    ObjectSetString (0, name, OBJPROP_TEXT,      text);
}

//--------------------------------------------------------------------
// BuildDashboard — called once in OnInit to create the background panel
//--------------------------------------------------------------------
void BuildDashboard()
{
    if(!InpShowDashboard) return;

    string bg = DashPrefix + "BG";
    if(ObjectFind(0, bg) < 0)
        ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);

    ObjectSetInteger(0, bg, OBJPROP_CORNER,      CORNER_LEFT_UPPER);
    ObjectSetInteger(0, bg, OBJPROP_XDISTANCE,   DASH_X);
    ObjectSetInteger(0, bg, OBJPROP_YDISTANCE,   DASH_Y);
    ObjectSetInteger(0, bg, OBJPROP_XSIZE,       DASH_W);
    ObjectSetInteger(0, bg, OBJPROP_YSIZE,       DASH_H);
    ObjectSetInteger(0, bg, OBJPROP_BGCOLOR,     InpDashBG);
    ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
    ObjectSetInteger(0, bg, OBJPROP_COLOR,       InpDashBG);
    ObjectSetInteger(0, bg, OBJPROP_SELECTABLE,  false);
    ObjectSetInteger(0, bg, OBJPROP_BACK,        true);
}

//--------------------------------------------------------------------
// UpdateDashboard — refresh all text labels; rate-limited to InpDashIntervalMs
//--------------------------------------------------------------------
void UpdateDashboard()
{
    if(!InpShowDashboard) return;

    uint now = GetTickCount();
    if(now - g_lastDashMs < InpDashIntervalMs) return;
    g_lastDashMs = now;

    int tx = DASH_X + DASH_PAD_X;
    int ty = DASH_Y + DASH_PAD_Y;
    int dy = DASH_LINE_H;

    string modeStr = InpFTMOMode ? "FTMO" : "MAX";
    color  tc      = InpDashText;

    // Title
    DashLabel(DashPrefix + "T0",
              StringFormat("ProTrader v5.00  [%s]  %s", modeStr, _Symbol),
              tx, ty, tc, DASH_FONT_SZ + 1);
    ty += dy + 2;

    // Separator
    DashLabel(DashPrefix + "SEP0",
              "────────────────────────────────",
              tx, ty, clrDimGray);
    ty += dy;

    // Account info
    DashLabel(DashPrefix + "L1",
              StringFormat("Balance : %s %.2f",
                           AccountInfoString(ACCOUNT_CURRENCY), g_balance),
              tx, ty, tc);
    ty += dy;

    DashLabel(DashPrefix + "L2",
              StringFormat("Equity  : %s %.2f",
                           AccountInfoString(ACCOUNT_CURRENCY), g_equity),
              tx, ty, tc);
    ty += dy;

    double floatPnL = g_equity - g_balance;
    color  floatClr = (floatPnL >= 0.0) ? clrLimeGreen : clrTomato;
    DashLabel(DashPrefix + "L3",
              StringFormat("Float   : %+.2f", floatPnL),
              tx, ty, floatClr);
    ty += dy;

    // Daily P&L
    double dailyPnL = g_balance - g_dailyStartBalance;
    color  dailyClr = (dailyPnL >= 0.0) ? clrLimeGreen : clrTomato;
    DashLabel(DashPrefix + "L4",
              StringFormat("Daily PnL: %+.2f", dailyPnL),
              tx, ty, dailyClr);
    ty += dy;

    // Drawdown
    double ddPct = (g_initialBalance > 0.0)
                   ? (g_initialBalance - MathMin(g_balance, g_equity)) / g_initialBalance * 100.0
                   : 0.0;
    color ddClr = (ddPct < InpMaxDailyLoss * 0.5) ? clrLimeGreen
                : (ddPct < InpMaxDailyLoss * 0.8)  ? clrYellow
                : clrTomato;
    DashLabel(DashPrefix + "L5",
              StringFormat("Total DD: %.2f%%  (lim %.1f%%)", ddPct, InpMaxTotalLoss),
              tx, ty, ddClr);
    ty += dy;

    // Trade stats
    DashLabel(DashPrefix + "L6",
              StringFormat("Open: %d/%d  W/L: %d/%d  Days: %d",
                           g_openTrades, InpMaxTrades,
                           g_winTrades,  g_lossTrades,
                           g_tradingDaysCount),
              tx, ty, tc);
    ty += dy;

    // Spread
    long   sp       = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
    int    spThresh = (InpPIDEnabled && InpSPIDEnabled) ? SPID_MaxSpread() : InpMaxSpreadPoints;
    color  spClr    = (sp <= (long)spThresh) ? clrLimeGreen : clrTomato;
    DashLabel(DashPrefix + "L7",
              StringFormat("Spread: %d pts  (gate %d)", (int)sp, spThresh),
              tx, ty, spClr);
    ty += dy;

    // Status message
    color stClr = (StringLen(g_statusMsg) > 0) ? clrOrange : clrDimGray;
    string stTxt = (StringLen(g_statusMsg) > 0) ? g_statusMsg : "Status: OK";
    DashLabel(DashPrefix + "L8", stTxt, tx, ty, stClr);
    ty += dy;

    // Separator before PID section
    DashLabel(DashPrefix + "SEP1",
              "────────────────────────────────",
              tx, ty, clrDimGray);
    ty += dy;

    // PID header
    DashLabel(DashPrefix + "PIDH",
              "PID Risk Controllers:",
              tx, ty, tc);
    ty += dy;

    // PID status block (5 lines from PID_StatusBlock, split on '\n')
    string pidBlock = PID_StatusBlock();
    string pidLines[];
    int    nLines   = StringSplit(pidBlock, '\n', pidLines);

    for(int k = 0; k < nLines; k++)
    {
        string lname = DashPrefix + "PID" + IntegerToString(k);
        color  lclr  = InpPIDEnabled ? clrCyan : clrDimGray;
        DashLabel(lname, pidLines[k], tx, ty, lclr, DASH_FONT_SZ - 1);
        ty += dy - 2;   // slightly tighter spacing for the 5 PID lines
    }

    ChartRedraw(0);
}

//--------------------------------------------------------------------
// DeleteDashboard — remove all dashboard objects from chart
//--------------------------------------------------------------------
void DeleteDashboard()
{
    ObjectsDeleteAll(0, DashPrefix);
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 13 — OnInit
//===================================================================
//+------------------------------------------------------------------+

int OnInit()
{
    //--- Build per-instance key prefixes (magic + symbol prevents collision
    //    between FTMO EA and MAX EA running on the same account/chart)
    g_gv       = StringFormat("PT_%d_%s_",  InpMagicNumber, _Symbol);
    DashPrefix = StringFormat("PTD_%d_%s_", InpMagicNumber, _Symbol);

    string modeLabel = InpFTMOMode ? "FTMO" : "MAX";
    Print(StringFormat("ProTrader v5.00 [%s] OnInit — Magic=%d Symbol=%s TF=%s",
                       modeLabel, InpMagicNumber, _Symbol,
                       EnumToString(InpMainTF)));

    //--- Validate all input parameters before doing anything else
    if(!ValidateInputs())
    {
        Print("ProTrader v5.00: ValidateInputs FAILED — EA will not trade");
        return INIT_PARAMETERS_INCORRECT;
    }

    //--- Trade object setup
    trade.SetExpertMagicNumber((ulong)InpMagicNumber);
    trade.SetDeviationInPoints(10);
    { long f = SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE);
      if     ((f & SYMBOL_FILLING_FOK) != 0) trade.SetTypeFilling(ORDER_FILLING_FOK);
      else if((f & SYMBOL_FILLING_IOC) != 0) trade.SetTypeFilling(ORDER_FILLING_IOC);
      else                                   trade.SetTypeFilling(ORDER_FILLING_RETURN); }
    trade.LogLevel(LOG_LEVEL_ERRORS);

    //--- Cache symbol constants (never change at runtime)
    g_digits  = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
    g_point   = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
    g_stopLvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
    g_minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
    g_maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
    g_lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

    //--- Pre-computed constants
    g_rrRatio       = (InpATRSLMulti > 0.0) ? InpATRTPMulti / InpATRSLMulti : 0.0;
    g_beDist_factor = InpBEAtRR * InpATRSLMulti;

    //--- Restore persisted GlobalVariables (survive EA restarts mid-challenge)
    double savedInitBal = GlobalVariableGet(g_gv + "InitBal");
    g_initialBalance    = (savedInitBal > 0.0) ? savedInitBal : AccountInfoDouble(ACCOUNT_BALANCE);

    // Persist initial balance on first run
    if(savedInitBal <= 0.0)
        GlobalVariableSet(g_gv + "InitBal", g_initialBalance);

    g_totalLimitHit   = (GlobalVariableGet(g_gv + "TotalHalt") > 0.5);
    g_profitTargetHit = (GlobalVariableGet(g_gv + "ProfitHit")  > 0.5);

    //--- Closed-trade CSV logger (optional; feeds the Monte Carlo validator)
    TradeLog_Init();

    double savedDayBal  = GlobalVariableGet(g_gv + "DayBal");
    double savedDayTime = GlobalVariableGet(g_gv + "DayTime");

    g_dailyStartBalance = (savedDayBal  > 0.0) ? savedDayBal  : g_initialBalance;
    g_lastDayTime       = (savedDayTime > 0.0) ? (datetime)savedDayTime : TimeCurrent();
    g_dailyStartEquity  = g_dailyStartBalance;  // best estimate on restart
    g_dailyLimitHit     = false;

    //--- Statistics
    g_tradingDaysCount  = 0;
    g_lastTradedDay     = 0;
    g_totalTrades       = 0;
    g_winTrades         = 0;
    g_lossTrades        = 0;
    g_totalPnL          = 0.0;
    g_statusMsg         = "";
    g_lastBar           = 0;
    g_lastDashMs        = 0;

    //--- Per-tick cache seed
    g_balance    = AccountInfoDouble(ACCOUNT_BALANCE);
    g_equity     = AccountInfoDouble(ACCOUNT_EQUITY);
    g_openTrades = CountOpenTrades();

    //--- Initialise all PID controllers
    PID_InitAll(InpRiskPerTrade, g_gv);

    //--- Create indicator handles — Main TF
    h_fastEMA = iMA(_Symbol, InpMainTF, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);
    if(h_fastEMA == INVALID_HANDLE)
    { Print("OnInit: iMA fastEMA handle invalid"); return INIT_FAILED; }

    h_slowEMA = iMA(_Symbol, InpMainTF, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
    if(h_slowEMA == INVALID_HANDLE)
    { Print("OnInit: iMA slowEMA handle invalid"); return INIT_FAILED; }

    h_trendEMA = iMA(_Symbol, InpMainTF, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);
    if(h_trendEMA == INVALID_HANDLE)
    { Print("OnInit: iMA trendEMA handle invalid"); return INIT_FAILED; }

    h_rsi = iRSI(_Symbol, InpMainTF, InpRSIPeriod, PRICE_CLOSE);
    if(h_rsi == INVALID_HANDLE)
    { Print("OnInit: iRSI handle invalid"); return INIT_FAILED; }

    h_atr = iATR(_Symbol, InpMainTF, InpATRPeriod);
    if(h_atr == INVALID_HANDLE)
    { Print("OnInit: iATR handle invalid"); return INIT_FAILED; }

    h_macd = iMACD(_Symbol, InpMainTF,
                   InpMACDFast, InpMACDSlow, InpMACDSignal, PRICE_CLOSE);
    if(h_macd == INVALID_HANDLE)
    { Print("OnInit: iMACD handle invalid"); return INIT_FAILED; }

    //--- Create indicator handles — Trend TF
    h_fastEMA_TF = iMA(_Symbol, InpTrendTF, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);
    if(h_fastEMA_TF == INVALID_HANDLE)
    { Print("OnInit: iMA fastEMA_TF handle invalid"); return INIT_FAILED; }

    h_slowEMA_TF = iMA(_Symbol, InpTrendTF, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
    if(h_slowEMA_TF == INVALID_HANDLE)
    { Print("OnInit: iMA slowEMA_TF handle invalid"); return INIT_FAILED; }

    h_trendEMA_TF = iMA(_Symbol, InpTrendTF, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);
    if(h_trendEMA_TF == INVALID_HANDLE)
    { Print("OnInit: iMA trendEMA_TF handle invalid"); return INIT_FAILED; }

    h_macd_TF = iMACD(_Symbol, InpTrendTF,
                      InpMACDFast, InpMACDSlow, InpMACDSignal, PRICE_CLOSE);
    if(h_macd_TF == INVALID_HANDLE)
    { Print("OnInit: iMACD_TF handle invalid"); return INIT_FAILED; }

    //--- Warn about halted state
    if(g_totalLimitHit)
        Print("ProTrader v5.00 [", modeLabel, "]: TOTAL HALT restored from GlobalVariables — no new trades");
    if(g_profitTargetHit)
        Print("ProTrader v5.00 [", modeLabel, "]: PROFIT TARGET already reached — no new trades");

    //--- Build dashboard panel
    BuildDashboard();

    Print(StringFormat("ProTrader v5.00 [%s] ready. InitBal=%.2f MinRisk=%.2f MaxRisk=%.2f R:R=%.3f",
                       modeLabel, g_initialBalance,
                       InpPIDMinRisk, InpPIDMaxRisk, g_rrRatio));

    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 14 — OnDeinit
//===================================================================
//+------------------------------------------------------------------+

void OnDeinit(const int reason)
{
    Print("ProTrader v5.00 OnDeinit — reason=", reason);

    //--- Release indicator handles
    if(h_fastEMA    != INVALID_HANDLE) IndicatorRelease(h_fastEMA);
    if(h_slowEMA    != INVALID_HANDLE) IndicatorRelease(h_slowEMA);
    if(h_trendEMA   != INVALID_HANDLE) IndicatorRelease(h_trendEMA);
    if(h_rsi        != INVALID_HANDLE) IndicatorRelease(h_rsi);
    if(h_atr        != INVALID_HANDLE) IndicatorRelease(h_atr);
    if(h_macd       != INVALID_HANDLE) IndicatorRelease(h_macd);
    if(h_fastEMA_TF != INVALID_HANDLE) IndicatorRelease(h_fastEMA_TF);
    if(h_slowEMA_TF != INVALID_HANDLE) IndicatorRelease(h_slowEMA_TF);
    if(h_trendEMA_TF!= INVALID_HANDLE) IndicatorRelease(h_trendEMA_TF);
    if(h_macd_TF    != INVALID_HANDLE) IndicatorRelease(h_macd_TF);

    DeleteDashboard();
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 15 — Core_TickBody (the main per-tick body)
//===================================================================
//+------------------------------------------------------------------+

void Core_TickBody()
{
    //------------------------------------------------------------------
    // 1. Refresh per-tick cache
    //------------------------------------------------------------------
    g_balance    = AccountInfoDouble(ACCOUNT_BALANCE);
    g_equity     = AccountInfoDouble(ACCOUNT_EQUITY);
    g_openTrades = CountOpenTrades();

    //------------------------------------------------------------------
    // 2. Push current spread to SPID every tick (not just bar-open)
    //    so the rolling window captures intrabar spread spikes fully.
    //------------------------------------------------------------------
    if(InpPIDEnabled && InpSPIDEnabled)
    {
        double spreadNow = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
        SPID_Update(spreadNow);
    }

    //------------------------------------------------------------------
    // 3. Risk management (day rollover, limit checks)
    //------------------------------------------------------------------
    UpdateRiskManagement();

    //------------------------------------------------------------------
    // 4. Update dashboard (rate-limited internally)
    //------------------------------------------------------------------
    UpdateDashboard();

    //------------------------------------------------------------------
    // 5. Manage open positions on every tick (breakeven + trailing)
    //------------------------------------------------------------------
    ManageOpenTrades();

    //------------------------------------------------------------------
    // 6. Hard-halt gate — do not open new positions if any limit hit
    //------------------------------------------------------------------
    if(g_dailyLimitHit || g_totalLimitHit || g_profitTargetHit)
        return;

    //------------------------------------------------------------------
    // 7. Bar-open gate — new-entry logic runs only on new bar open
    //------------------------------------------------------------------
    datetime currentBar = iTime(_Symbol, InpMainTF, 0);
    if(currentBar == g_lastBar) return;
    g_lastBar = currentBar;

    //------------------------------------------------------------------
    // 8. Session filter
    //------------------------------------------------------------------
    if(!IsInTradingSession()) return;

    //------------------------------------------------------------------
    // 9. News filter
    //------------------------------------------------------------------
    if(IsNewsTime()) return;

    //------------------------------------------------------------------
    // 10. Max open trades gate
    //------------------------------------------------------------------
    if(g_openTrades >= InpMaxTrades) return;

    //------------------------------------------------------------------
    // 11. Profit target gate (soft — no new entries, but keep positions)
    //------------------------------------------------------------------
    if(g_profitTargetHit) return;

    //------------------------------------------------------------------
    // 12. Load indicator values
    //------------------------------------------------------------------
    IndicatorValues iv;
    if(!LoadIndicators(iv)) return;

    //------------------------------------------------------------------
    // 13. Generate signal
    //------------------------------------------------------------------
    ENUM_SIGNAL sig = GetSignal(iv);
    if(sig == SIGNAL_NONE) return;

    //------------------------------------------------------------------
    // 14. Execute trade
    //------------------------------------------------------------------
    if(sig == SIGNAL_BUY)
        ExecuteBuy(iv.atr);
    else if(sig == SIGNAL_SELL)
        ExecuteSell(iv.atr);
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 16 — OnTick (reentrancy-guarded)
//===================================================================
//+------------------------------------------------------------------+

void OnTick()
{
    static bool s_inTick = false;
    if(s_inTick) return;
    s_inTick = true;
    Core_TickBody();
    s_inTick = false;
}

//+------------------------------------------------------------------+
//===================================================================
// SECTION 17 — OnTradeTransaction
//===================================================================
//+------------------------------------------------------------------+

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &request,
                        const MqlTradeResult      &result)
{
    //--- request/result are part of the fixed handler signature but unused
    //    here. This never-executed branch references them so MetaEditor does
    //    not emit "unreferenced formal parameter" warnings.
    if(false) Print(request.symbol, result.retcode);

    //--- We are interested only in deal-add transactions (closed positions)
    if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;

    ulong dealTicket = trans.deal;
    if(dealTicket == 0) return;

    //--- Select the deal from history
    if(!HistoryDealSelect(dealTicket)) return;

    //--- Verify it belongs to this EA and symbol
    if(HistoryDealGetString(dealTicket, DEAL_SYMBOL) != _Symbol)       return;
    if(HistoryDealGetInteger(dealTicket, DEAL_MAGIC) != (long)InpMagicNumber) return;

    //--- Only process exit deals (not entry fills)
    ENUM_DEAL_ENTRY entryType = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
    if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_INOUT) return;

    double profit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
    if(!MathIsValidNumber(profit)) return;

    bool isWin = (profit >= 0.0);

    //--- Update statistics
    g_totalTrades++;
    g_totalPnL += profit;
    if(isWin) g_winTrades++;
    else       g_lossTrades++;

    //--- Notify PID system
    PID_NotifyTrade(isWin);

    //--- Append to the closed-trade CSV (no-op when InpLogTrades is false)
    TradeLog_Append(profit,
                    AccountInfoDouble(ACCOUNT_BALANCE),
                    AccountInfoDouble(ACCOUNT_EQUITY),
                    isWin,
                    PID_LastEffectiveRisk());

    Print(StringFormat("ProTrader v5.00 | Trade closed: ticket=#%I64u profit=%.2f %s  W=%d L=%d",
                       dealTicket, profit, isWin ? "WIN" : "LOSS",
                       g_winTrades, g_lossTrades));
}

#endif // PROTRADER_CORE_MQH
//+------------------------------------------------------------------+
