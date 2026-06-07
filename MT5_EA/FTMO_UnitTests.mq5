//+------------------------------------------------------------------+
//|                    FTMO_UnitTests.mq5                            |
//|  Self-contained test harness for FTMO ProTrader EA logic         |
//|  Run as a Script on any chart — results appear in Journal tab    |
//+------------------------------------------------------------------+
#property copyright "FTMO ProTrader EA Tests"
#property script_show_inputs
#property version "1.10"

input double InpStartBalance = 100000.0; // Test account balance ($)

//--- Test counters
int g_pass = 0;
int g_fail = 0;

//+------------------------------------------------------------------+
//| Assertion helpers                                                |
//+------------------------------------------------------------------+
void AssertTrue(string name, bool cond)
{
    if(cond) { Print("[PASS] ", name); g_pass++; }
    else      { Print("[FAIL] ", name, " — expected TRUE"); g_fail++; }
}
void AssertFalse(string name, bool cond)
{
    if(!cond) { Print("[PASS] ", name); g_pass++; }
    else       { Print("[FAIL] ", name, " — expected FALSE"); g_fail++; }
}
void AssertNear(string name, double got, double expected, double tol=0.0001)
{
    if(MathAbs(got - expected) <= tol)
        { Print("[PASS] ", name, " (", DoubleToString(got,6), ")"); g_pass++; }
    else
        { Print("[FAIL] ", name, " got=", DoubleToString(got,6), " expected=", DoubleToString(expected,6)); g_fail++; }
}
void AssertGT(string name, double a, double b)
{
    if(a > b) { Print("[PASS] ", name, " (", a, " > ", b, ")"); g_pass++; }
    else       { Print("[FAIL] ", name, " — expected ", a, " > ", b); g_fail++; }
}
void AssertLE(string name, double a, double b)
{
    if(a <= b) { Print("[PASS] ", name, " (", a, " <= ", b, ")"); g_pass++; }
    else        { Print("[FAIL] ", name, " — expected ", a, " <= ", b); g_fail++; }
}
void Section(string s)
{ Print("\n──── ", s, " ────"); }

//============================================================
// MODULE 1 — LOT SIZE CALCULATION
// Mirrors CalcLotSize() logic from the EA, inlined for testing
//============================================================
double TestCalcLotSize(double balance, double riskPct, double slPoints,
                       double tickVal, double tickSz,
                       double minLot, double maxLot, double lotStep)
{
    if(tickSz <= 0 || slPoints <= 0 || tickVal <= 0) return 0;
    double riskAmt       = balance * riskPct / 100.0;
    double valuePerPoint = (slPoints / tickSz) * tickVal;
    double lots          = riskAmt / valuePerPoint;
    lots = MathFloor(lots / lotStep) * lotStep;
    lots = MathMax(minLot, MathMin(maxLot, lots));
    //--- Over-risk guard (mirrors EA v3.10): skip if min lot risks > 1.5× target
    double actualRisk = lots * valuePerPoint;
    if(actualRisk > riskAmt * 1.5) return 0;
    return lots;
}

void TestLotSizing()
{
    Section("LOT SIZE CALCULATION");

    // EURUSD-like: tickVal=1.0, tickSz=0.00001, point=0.00001
    // Risk 1% of 100k = $1000, SL = 20 pips = 0.0020
    // ticksInSL = 0.0020/0.00001 = 200, lots = 1000/(200*1) = 5.00
    double l = TestCalcLotSize(100000, 1.0, 0.0020, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("1% risk 100k, 20-pip SL on EURUSD = 5.00 lots", l, 5.00, 0.01);

    // Halved balance
    double l2 = TestCalcLotSize(50000, 1.0, 0.0020, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("1% risk 50k = 2.50 lots", l2, 2.50, 0.01);

    // Wider SL (40 pips)
    double l3 = TestCalcLotSize(100000, 1.0, 0.0040, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("1% risk 100k, 40-pip SL = 2.50 lots", l3, 2.50, 0.01);

    // Risk 0.5%
    double l4 = TestCalcLotSize(100000, 0.5, 0.0020, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("0.5% risk = 2.50 lots", l4, 2.50, 0.01);

    // Guard: zero SL
    double l5 = TestCalcLotSize(100000, 1.0, 0.0, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Zero SL returns 0 lots", l5, 0.0);

    // Guard: zero tickVal
    double l6 = TestCalcLotSize(100000, 1.0, 0.0020, 0.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Zero tickVal returns 0 lots", l6, 0.0);

    // Clamps to maxLot
    double l7 = TestCalcLotSize(100000, 50.0, 0.0001, 1.0, 0.00001, 0.01, 10.0, 0.01);
    AssertLE("Lot clamped to maxLot=10.0", l7, 10.0);

    // Small raw lot clamps UP to minLot when risk stays within 1.5× tolerance
    double l8 = TestCalcLotSize(100000, 0.01, 0.012, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Tiny risk clamps up to minLot=0.01 (within tolerance)", l8, 0.01, 0.0001);

    // Over-risk guard: minLot would risk >> target on a small account → skip (0 lots)
    double l9 = TestCalcLotSize(1000, 0.01, 0.0200, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Over-risk min lot is skipped (returns 0)", l9, 0.0, 0.0001);
}

//============================================================
// MODULE 2 — FTMO DAILY LOSS LIMIT LOGIC
//============================================================

bool TestDailyLimitHit(double initBal, double dailyStartBal, double dailyStartEq,
                       double curBal, double curEq, double limitPct)
{
    double dailyRef    = MathMin(dailyStartBal, dailyStartEq);
    double worstEquity = MathMin(curBal, curEq);
    double lossPct     = (dailyRef - worstEquity) / initBal * 100.0;
    return lossPct >= limitPct;
}

void TestDailyLossLimit()
{
    Section("DAILY LOSS LIMIT (4.5% of initial)");

    double init = InpStartBalance; // 100k

    // Exactly at 4.5% daily loss → MUST trigger
    double eq1 = init - init * 4.5 / 100.0;  // 95500
    AssertTrue("4.5% equity loss triggers limit", TestDailyLimitHit(init,init,init,init,eq1,4.5));

    // Just under 4.5% → must NOT trigger
    double eq2 = init - init * 4.49 / 100.0;
    AssertFalse("4.49% equity loss does NOT trigger", TestDailyLimitHit(init,init,init,init,eq2,4.5));

    // Loss only on open positions (equity < balance): balance unchanged, equity down
    AssertTrue("Floating loss on positions triggers limit",
               TestDailyLimitHit(init, init, init, init, init - init*0.046, 4.5));

    // Day started at lower balance (previous losses already taken)
    // dailyStart=97k (already lost 3k on prior days), equity drops 4.5k on this day → triggers
    double ds = 97000.0;
    AssertTrue("Intraday loss from lower start triggers",
               TestDailyLimitHit(init, ds, ds, ds, ds - init*0.046, 4.5));

    // No loss
    AssertFalse("No loss does not trigger",
                TestDailyLimitHit(init,init,init,init,init,4.5));

    // Profit — never triggers
    AssertFalse("Profit does not trigger daily limit",
                TestDailyLimitHit(init,init,init,init,init+5000,4.5));
}

//============================================================
// MODULE 3 — TOTAL DRAWDOWN LIMIT
//============================================================

bool TestTotalDDHit(double initBal, double curBal, double curEq, double limitPct)
{
    double worstEquity = MathMin(curBal, curEq);
    double pct = (initBal - worstEquity) / initBal * 100.0;
    return pct >= limitPct;
}

void TestTotalDrawdown()
{
    Section("TOTAL DRAWDOWN LIMIT (9.0%)");

    double init = InpStartBalance;

    AssertTrue ("9.0% total DD triggers",       TestTotalDDHit(init, init, init-init*0.09, 9.0));
    AssertFalse("8.9% total DD does NOT trigger",TestTotalDDHit(init, init, init-init*0.089, 9.0));
    AssertTrue ("10% total DD triggers",         TestTotalDDHit(init, init-init*0.10, init-init*0.10, 9.0));

    // Balance erosion from closed losses: balance=95k, equity=95k → 5% dd
    AssertFalse("5% realised loss does not hit 9% limit", TestTotalDDHit(init,95000,95000,9.0));

    // Consecutive losses: balance=91k, equity=90.5k
    AssertTrue ("91k balance + 90.5k equity hits 9% limit", TestTotalDDHit(init,91000,90500,9.0));
}

//============================================================
// MODULE 4 — PROFIT TARGET DETECTION
//============================================================

bool TestProfitTargetHit(double initBal, double curBal, double targetPct)
{
    return (curBal - initBal) / initBal * 100.0 >= targetPct;
}

void TestProfitTarget()
{
    Section("PROFIT TARGET (10%)");

    double init = InpStartBalance;
    AssertTrue ("Exactly 10% profit hits target",   TestProfitTargetHit(init, init*1.10,    10.0));
    AssertTrue ("11% profit hits target",            TestProfitTargetHit(init, init*1.11,    10.0));
    AssertFalse("9.99% profit does NOT hit target",  TestProfitTargetHit(init, init*1.0999,  10.0));
    AssertFalse("0% profit does not hit target",     TestProfitTargetHit(init, init,         10.0));
    AssertFalse("Loss does not hit target",          TestProfitTargetHit(init, init*0.95,    10.0));
}

//============================================================
// MODULE 5 — RISK:REWARD RATIO CHECK
//============================================================

void TestRiskReward()
{
    Section("RISK:REWARD RATIO (SL 1.5×ATR, TP 2.5×ATR)");

    double slMulti = 1.5;
    double tpMulti = 2.5;
    double rr = tpMulti / slMulti;

    AssertNear("R:R = 1.667", rr, 1.6667, 0.001);
    AssertGT("TP multiplier > SL multiplier (positive edge)", tpMulti, slMulti);

    // Minimum win rate needed to break even: 1/(1+RR)
    double minWR = 1.0 / (1.0 + rr) * 100.0;
    AssertLE("Break-even win rate < 40%", minWR, 40.0);
    Print("  Break-even win rate: ", DoubleToString(minWR, 2), "% (need to win this often to not lose)");
}

//============================================================
// MODULE 6 — SESSION FILTER LOGIC
//============================================================

bool TestSession(int hour, int dow, bool useLondon, bool useNY)
{
    if(dow == 0 || dow == 6) return false;
    if(dow == 5 && hour >= 21) return false;
    if(dow == 1 && hour == 0) return false;
    bool in = false;
    if(useLondon && hour >= 8  && hour < 16) in = true;
    if(useNY     && hour >= 13 && hour < 21) in = true;
    return in;
}

void TestSessionFilter()
{
    Section("SESSION FILTER");

    // London
    AssertTrue ("London session: Mon 09:00 allowed",      TestSession(9, 1,true,true));
    AssertTrue ("London session: Wed 12:00 allowed",      TestSession(12,3,true,true));
    AssertFalse("London closed: Mon 07:00 blocked",       TestSession(7, 1,true,true));
    AssertFalse("London closed: Mon 16:00 blocked",       TestSession(16,1,true,true));

    // NY session
    AssertTrue ("NY session: Tue 15:00 allowed",          TestSession(15,2,true,true));
    AssertTrue ("Overlap London+NY: Wed 14:00 allowed",   TestSession(14,3,true,true));
    AssertFalse("NY closed: Mon 22:00 blocked",           TestSession(22,1,true,true));

    // Weekend
    AssertFalse("Saturday blocked",                       TestSession(12,6,true,true));
    AssertFalse("Sunday blocked",                         TestSession(12,0,true,true));

    // Friday close
    AssertFalse("Friday 21:00 blocked",                   TestSession(21,5,true,true));
    AssertTrue ("Friday 20:00 still allowed",             TestSession(20,5,true,true));

    // Monday gap open
    AssertFalse("Monday 00:00 blocked (gap protection)",  TestSession(0, 1,true,true));
    AssertTrue ("Monday 01:00 allowed",                   TestSession(1, 1,true,true));

    // Sessions individually disabled
    AssertFalse("No sessions enabled = blocked",          TestSession(10,2,false,false));
    AssertTrue ("Only London enabled: 10:00 ok",          TestSession(10,2,true,false));
    AssertFalse("Only NY enabled: 10:00 blocked",         TestSession(10,2,false,true));
}

//============================================================
// MODULE 7 — LOT STEP NORMALIZATION
//============================================================

void TestLotNormalization()
{
    Section("LOT STEP NORMALIZATION");

    // Verify floor rounding (never round up — that would exceed risk)
    double step = 0.01;
    double raw  = 1.2378;
    double norm = MathFloor(raw / step) * step;
    AssertNear("1.2378 floored to 0.01 step = 1.23", norm, 1.23, 0.0001);

    double raw2 = 0.00712;
    double norm2 = MathFloor(raw2 / step) * step;
    AssertNear("0.00712 floors to 0.00 (below minLot)", norm2, 0.00, 0.0001);

    // With 0.1 step
    double step2 = 0.1;
    double raw3  = 3.85;
    double norm3 = MathFloor(raw3 / step2) * step2;
    AssertNear("3.85 floored to 0.1 step = 3.8", norm3, 3.8, 0.0001);
}

//============================================================
// MODULE 8 — ATR-BASED SL/TP DISTANCES
//============================================================

void TestATRDistances()
{
    Section("ATR SL/TP DISTANCES");

    // Typical EURUSD ATR(14) on H1 ≈ 0.0010 (10 pips)
    double atr = 0.0010;
    double slDist = atr * 1.5;
    double tpDist = atr * 2.5;

    AssertNear("SL distance = 1.5×ATR = 15 pips", slDist, 0.0015, 0.00001);
    AssertNear("TP distance = 2.5×ATR = 25 pips", tpDist, 0.0025, 0.00001);
    AssertGT  ("TP > SL distance", tpDist, slDist);

    // Buy levels
    double ask = 1.10000;
    double sl  = NormalizeDouble(ask - slDist, 5);
    double tp  = NormalizeDouble(ask + tpDist, 5);
    AssertNear("Buy SL below entry", sl, 1.09985, 0.00001);
    AssertNear("Buy TP above entry", tp, 1.10025, 0.00001);
    AssertGT  ("Buy TP > entry", tp, ask);
    AssertGT  ("Buy entry > Buy SL", ask, sl);

    // Sell levels
    double bid = 1.10000;
    double sslSell = NormalizeDouble(bid + slDist, 5);
    double stpSell = NormalizeDouble(bid - tpDist, 5);
    AssertGT  ("Sell SL above entry", sslSell, bid);
    AssertGT  ("Sell entry > Sell TP", bid, stpSell);
}

//============================================================
// MODULE 9 — SPREAD FILTER
// Mirrors IsSpreadOK(): reject entry when spread > InpMaxSpreadPoints
//============================================================

bool TestSpreadOK(long spread, int maxSpread)
{
    return (spread <= maxSpread);
}

void TestSpreadFilter()
{
    Section("SPREAD FILTER (max 30 points default)");

    AssertTrue ("Spread 10 <= 30 allowed",      TestSpreadOK(10, 30));
    AssertTrue ("Spread exactly 30 allowed",    TestSpreadOK(30, 30));
    AssertFalse("Spread 31 blocked",            TestSpreadOK(31, 30));
    AssertFalse("Spread 200 (news spike) blocked", TestSpreadOK(200, 30));
    AssertTrue ("Spread 0 allowed",             TestSpreadOK(0, 30));
}

//============================================================
// MODULE 10 — INPUT VALIDATION
// Mirrors ValidateInputs(): config that could violate FTMO is rejected
//============================================================

bool TestValidateInputs(double risk, double dailyLoss, double totalLoss,
                        int fastEMA, int slowEMA, int trendEMA,
                        double rsiOB, double rsiOS, int maxTrades, int maxSpread)
{
    if(risk <= 0.0 || risk > 5.0)           return false;
    if(dailyLoss <= 0.0 || dailyLoss >= 5.0) return false;
    if(totalLoss <= 0.0 || totalLoss >= 10.0) return false;
    if(fastEMA >= slowEMA)                   return false;
    if(slowEMA >= trendEMA)                  return false;
    if(rsiOB <= rsiOS)                       return false;
    if(maxTrades < 1)                        return false;
    if(maxSpread <= 0)                       return false;
    return true;
}

void TestInputValidation()
{
    Section("INPUT VALIDATION");

    // Valid default config
    AssertTrue ("Default config is valid",
                TestValidateInputs(1.0, 4.5, 9.0, 20, 50, 200, 65, 35, 1, 30));

    // FTMO hard-limit violations
    AssertFalse("Daily loss >= 5% rejected",
                TestValidateInputs(1.0, 5.0, 9.0, 20, 50, 200, 65, 35, 1, 30));
    AssertFalse("Total loss >= 10% rejected",
                TestValidateInputs(1.0, 4.5, 10.0, 20, 50, 200, 65, 35, 1, 30));

    // Risk bounds
    AssertFalse("Risk 0% rejected",   TestValidateInputs(0.0, 4.5, 9.0, 20, 50, 200, 65, 35, 1, 30));
    AssertFalse("Risk 6% rejected",   TestValidateInputs(6.0, 4.5, 9.0, 20, 50, 200, 65, 35, 1, 30));

    // EMA ordering
    AssertFalse("FastEMA >= SlowEMA rejected",
                TestValidateInputs(1.0, 4.5, 9.0, 50, 50, 200, 65, 35, 1, 30));
    AssertFalse("SlowEMA >= TrendEMA rejected",
                TestValidateInputs(1.0, 4.5, 9.0, 20, 200, 200, 65, 35, 1, 30));

    // RSI ordering
    AssertFalse("RSI overbought <= oversold rejected",
                TestValidateInputs(1.0, 4.5, 9.0, 20, 50, 200, 35, 65, 1, 30));

    // Misc
    AssertFalse("MaxTrades < 1 rejected",
                TestValidateInputs(1.0, 4.5, 9.0, 20, 50, 200, 65, 35, 0, 30));
    AssertFalse("MaxSpread <= 0 rejected",
                TestValidateInputs(1.0, 4.5, 9.0, 20, 50, 200, 65, 35, 1, 0));
}

//============================================================
// MAIN
//============================================================

void OnStart()
{
    Print("════════════════════════════════════════════");
    Print("  FTMO ProTrader EA — Unit Test Suite");
    Print("  Balance: $", InpStartBalance);
    Print("════════════════════════════════════════════");

    TestLotSizing();
    TestDailyLossLimit();
    TestTotalDrawdown();
    TestProfitTarget();
    TestRiskReward();
    TestSessionFilter();
    TestLotNormalization();
    TestATRDistances();
    TestSpreadFilter();
    TestInputValidation();

    Print("\n════════════════════════════════════════════");
    int total = g_pass + g_fail;
    double pct = (total > 0) ? (double)g_pass / total * 100.0 : 0;
    Print("  RESULTS: ", g_pass, "/", total, " passed  (",
          DoubleToString(pct, 1), "%)");
    if(g_fail == 0)
        Print("  ALL TESTS PASSED ✓");
    else
        Print("  FAILURES: ", g_fail, " — review [FAIL] lines above");
    Print("════════════════════════════════════════════");
}
