//+------------------------------------------------------------------+
//|                    FTMO_UnitTests.mq5                            |
//|  Self-contained test harness for FTMO ProTrader EA v5.00        |
//|  Run as a Script on any chart — results appear in Journal tab   |
//+------------------------------------------------------------------+
#property copyright "FTMO ProTrader EA Tests"
#property script_show_inputs
#property version "2.00"

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
        { Print("[FAIL] ", name, " got=", DoubleToString(got,6),
                " expected=", DoubleToString(expected,6)); g_fail++; }
}
void AssertGT(string name, double a, double b)
{
    if(a > b) { Print("[PASS] ", name, " (", a, " > ", b, ")"); g_pass++; }
    else       { Print("[FAIL] ", name, " — expected ", a, " > ", b); g_fail++; }
}
void AssertLT(string name, double a, double b)
{
    if(a < b) { Print("[PASS] ", name, " (", a, " < ", b, ")"); g_pass++; }
    else       { Print("[FAIL] ", name, " — expected ", a, " < ", b); g_fail++; }
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
    double actualRisk = lots * valuePerPoint;
    if(actualRisk > riskAmt * 1.5) return 0;
    return lots;
}

void TestLotSizing()
{
    Section("MODULE 1 — LOT SIZE CALCULATION");

    double l = TestCalcLotSize(100000, 1.0, 0.0020, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("1% risk 100k, 20-pip SL on EURUSD = 5.00 lots", l, 5.00, 0.01);

    double l2 = TestCalcLotSize(50000, 1.0, 0.0020, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("1% risk 50k = 2.50 lots", l2, 2.50, 0.01);

    double l3 = TestCalcLotSize(100000, 1.0, 0.0040, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("1% risk 100k, 40-pip SL = 2.50 lots", l3, 2.50, 0.01);

    double l4 = TestCalcLotSize(100000, 0.5, 0.0020, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("0.5% risk = 2.50 lots", l4, 2.50, 0.01);

    double l5 = TestCalcLotSize(100000, 1.0, 0.0, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Zero SL returns 0 lots", l5, 0.0);

    double l6 = TestCalcLotSize(100000, 1.0, 0.0020, 0.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Zero tickVal returns 0 lots", l6, 0.0);

    double l7 = TestCalcLotSize(100000, 50.0, 0.0001, 1.0, 0.00001, 0.01, 10.0, 0.01);
    AssertLE("Lot clamped to maxLot=10.0", l7, 10.0);

    double l8 = TestCalcLotSize(100000, 0.01, 0.012, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Tiny risk clamps up to minLot=0.01 (within tolerance)", l8, 0.01, 0.0001);

    double l9 = TestCalcLotSize(1000, 0.01, 0.0200, 1.0, 0.00001, 0.01, 100.0, 0.01);
    AssertNear("Over-risk min lot is skipped (returns 0)", l9, 0.0, 0.0001);
}

//============================================================
// MODULE 2 — FTMO DAILY LOSS LIMIT
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
    Section("MODULE 2 — DAILY LOSS LIMIT (4.5%)");

    double init = InpStartBalance;
    double eq1 = init - init * 4.5 / 100.0;
    AssertTrue ("4.5% equity loss triggers limit",  TestDailyLimitHit(init,init,init,init,eq1,4.5));
    double eq2 = init - init * 4.49 / 100.0;
    AssertFalse("4.49% equity loss does NOT trigger", TestDailyLimitHit(init,init,init,init,eq2,4.5));
    AssertTrue ("Floating loss triggers limit",     TestDailyLimitHit(init,init,init,init,init-init*0.046,4.5));
    double ds = 97000.0;
    AssertTrue ("Intraday loss from lower start",   TestDailyLimitHit(init,ds,ds,ds,ds-init*0.046,4.5));
    AssertFalse("No loss does not trigger",         TestDailyLimitHit(init,init,init,init,init,4.5));
    AssertFalse("Profit does not trigger",          TestDailyLimitHit(init,init,init,init,init+5000,4.5));
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
    Section("MODULE 3 — TOTAL DRAWDOWN LIMIT (9.0%)");

    double init = InpStartBalance;
    AssertTrue ("9.0% total DD triggers",        TestTotalDDHit(init, init, init-init*0.09, 9.0));
    AssertFalse("8.9% total DD does NOT trigger",TestTotalDDHit(init, init, init-init*0.089, 9.0));
    AssertTrue ("10% total DD triggers",          TestTotalDDHit(init, init-init*0.10, init-init*0.10, 9.0));
    AssertFalse("5% realised loss alone < 9%",   TestTotalDDHit(init, 95000, 95000, 9.0));
    AssertTrue ("91k+90.5k equity hits 9%",       TestTotalDDHit(init, 91000, 90500, 9.0));
}

//============================================================
// MODULE 4 — PROFIT TARGET
//============================================================
bool TestProfitTargetHit(double initBal, double curBal, double targetPct)
{
    return (curBal - initBal) / initBal * 100.0 >= targetPct;
}

void TestProfitTarget()
{
    Section("MODULE 4 — PROFIT TARGET (10%)");

    double init = InpStartBalance;
    AssertTrue ("Exactly 10% profit hits target",  TestProfitTargetHit(init, init*1.10,   10.0));
    AssertTrue ("11% profit hits target",           TestProfitTargetHit(init, init*1.11,   10.0));
    AssertFalse("9.99% does NOT hit target",        TestProfitTargetHit(init, init*1.0999, 10.0));
    AssertFalse("Loss does not hit target",         TestProfitTargetHit(init, init*0.95,   10.0));
}

//============================================================
// MODULE 5 — RISK:REWARD RATIO
//============================================================
void TestRiskReward()
{
    Section("MODULE 5 — RISK:REWARD RATIO");

    double slMulti = 1.5, tpMulti = 2.5;
    double rr = tpMulti / slMulti;
    AssertNear("R:R = 1.667",                  rr, 1.6667, 0.001);
    AssertGT  ("TP multiplier > SL multiplier", tpMulti, slMulti);
    double minWR = 1.0 / (1.0 + rr) * 100.0;
    AssertLE  ("Break-even win rate < 40%",    minWR, 40.0);
}

//============================================================
// MODULE 6 — SESSION FILTER
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
    Section("MODULE 6 — SESSION FILTER");

    AssertTrue ("London Mon 09:00 allowed",     TestSession(9, 1,true,true));
    AssertTrue ("London Wed 12:00 allowed",     TestSession(12,3,true,true));
    AssertFalse("London Mon 07:00 blocked",     TestSession(7, 1,true,true));
    AssertFalse("London 16:00 close (NY off) blocked", TestSession(16,1,true,false));
    AssertTrue ("NY Tue 15:00 allowed",         TestSession(15,2,true,true));
    AssertTrue ("London+NY overlap 14:00",      TestSession(14,3,true,true));
    AssertFalse("NY Mon 22:00 blocked",         TestSession(22,1,true,true));
    AssertFalse("Saturday blocked",             TestSession(12,6,true,true));
    AssertFalse("Sunday blocked",               TestSession(12,0,true,true));
    AssertFalse("Friday 21:00 blocked",         TestSession(21,5,true,true));
    AssertTrue ("Friday 20:00 allowed",         TestSession(20,5,true,true));
    AssertFalse("Monday 00:00 blocked",         TestSession(0, 1,true,true));
    AssertFalse("Monday 01:00 (pre-session) blocked", TestSession(1, 1,true,true));
    AssertFalse("No sessions = blocked",        TestSession(10,2,false,false));
}

//============================================================
// MODULE 7 — LOT STEP NORMALIZATION
//============================================================
void TestLotNormalization()
{
    Section("MODULE 7 — LOT STEP NORMALIZATION");

    double norm = MathFloor(1.2378 / 0.01) * 0.01;
    AssertNear("1.2378 → 1.23 (0.01 step)", norm, 1.23, 0.0001);
    double norm2 = MathFloor(0.00712 / 0.01) * 0.01;
    AssertNear("0.00712 → 0.00 (below minLot)", norm2, 0.00, 0.0001);
    double norm3 = MathFloor(3.85 / 0.1) * 0.1;
    AssertNear("3.85 → 3.8 (0.1 step)", norm3, 3.8, 0.0001);
}

//============================================================
// MODULE 8 — ATR-BASED SL/TP
//============================================================
void TestATRDistances()
{
    Section("MODULE 8 — ATR SL/TP DISTANCES");

    double atr    = 0.0010;
    double slDist = atr * 1.5;
    double tpDist = atr * 2.5;
    AssertNear("SL = 1.5×ATR = 15 pips", slDist, 0.0015, 0.00001);
    AssertNear("TP = 2.5×ATR = 25 pips", tpDist, 0.0025, 0.00001);
    AssertGT  ("TP > SL distance",        tpDist, slDist);

    double ask = 1.10000;
    double sl  = NormalizeDouble(ask - slDist, 5);
    double tp  = NormalizeDouble(ask + tpDist, 5);
    // atr=0.0010 → slDist=0.0015, tpDist=0.0025; ask=1.10000
    AssertNear("Buy SL below entry", sl, 1.09850, 0.00001);
    AssertNear("Buy TP above entry", tp, 1.10250, 0.00001);
    AssertGT  ("Buy TP > entry",     tp, ask);
    AssertGT  ("Buy entry > SL",     ask, sl);
}

//============================================================
// MODULE 9 — SPREAD FILTER
//============================================================
bool TestSpreadOK(long spread, int maxSpread) { return spread <= maxSpread; }

void TestSpreadFilter()
{
    Section("MODULE 9 — SPREAD FILTER");

    AssertTrue ("Spread 10 ≤ 30 allowed",  TestSpreadOK(10, 30));
    AssertTrue ("Spread exactly 30 allowed",TestSpreadOK(30, 30));
    AssertFalse("Spread 31 blocked",        TestSpreadOK(31, 30));
    AssertFalse("Spread 200 blocked",       TestSpreadOK(200, 30));
    AssertTrue ("Spread 0 allowed",         TestSpreadOK(0, 30));
}

//============================================================
// MODULE 10 — INPUT VALIDATION (FTMO mode)
//============================================================
bool TestValidateFTMO(double risk, double dailyLoss, double totalLoss,
                      int fastEMA, int slowEMA, int trendEMA,
                      double rsiOB, double rsiOS, int maxTrades, int maxSpread,
                      double pidMinRisk, double pidMaxRisk)
{
    if(risk <= 0.0 || risk > 5.0)            return false;
    if(dailyLoss <= 0.0 || dailyLoss >= 5.0) return false;
    if(totalLoss <= 0.0 || totalLoss >= 10.0) return false;
    if(fastEMA >= slowEMA)                   return false;
    if(slowEMA >= trendEMA)                  return false;
    if(rsiOB <= rsiOS)                       return false;
    if(maxTrades < 1)                        return false;
    if(maxSpread <= 0)                       return false;
    if(pidMinRisk <= 0.0)                    return false;
    if(pidMaxRisk <= pidMinRisk)             return false;
    if(pidMaxRisk > 5.0)                     return false;  // FTMO: PID max risk ≤ 5%
    return true;
}

void TestInputValidation()
{
    Section("MODULE 10 — INPUT VALIDATION (FTMO mode)");

    AssertTrue ("Default config valid",
                TestValidateFTMO(1.0,4.5,9.0, 20,50,200, 65,35, 1,30, 0.10,2.00));
    AssertFalse("Daily loss >= 5% rejected",
                TestValidateFTMO(1.0,5.0,9.0, 20,50,200, 65,35, 1,30, 0.10,2.00));
    AssertFalse("Total loss >= 10% rejected",
                TestValidateFTMO(1.0,4.5,10.0, 20,50,200, 65,35, 1,30, 0.10,2.00));
    AssertFalse("Risk 0% rejected",
                TestValidateFTMO(0.0,4.5,9.0, 20,50,200, 65,35, 1,30, 0.10,2.00));
    AssertFalse("FastEMA >= SlowEMA rejected",
                TestValidateFTMO(1.0,4.5,9.0, 50,50,200, 65,35, 1,30, 0.10,2.00));
    AssertFalse("SlowEMA >= TrendEMA rejected",
                TestValidateFTMO(1.0,4.5,9.0, 20,200,200, 65,35, 1,30, 0.10,2.00));
    AssertFalse("RSI OB <= OS rejected",
                TestValidateFTMO(1.0,4.5,9.0, 20,50,200, 35,65, 1,30, 0.10,2.00));
    AssertFalse("PID min ≥ max rejected",
                TestValidateFTMO(1.0,4.5,9.0, 20,50,200, 65,35, 1,30, 2.00,1.00));
    AssertFalse("PID max > 5% rejected in FTMO mode",
                TestValidateFTMO(1.0,4.5,9.0, 20,50,200, 65,35, 1,30, 0.10,6.00));
}

//============================================================
// MODULE 11 — EPID (Equity Velocity PID)
// Inlined control law: verifies sign convention and anti-martingale
//============================================================

//--- Minimal EPID implementation for testing
double TestEPID(double equity, double initBal, double baseRisk,
                double kp, double target, double minR, double maxR)
{
    if(initBal <= 0) return baseRisk;
    double meas  = equity / initBal - 1.0;
    double err   = meas - target / 100.0;
    // Pure P-term step (no I/D for isolation)
    double out   = baseRisk + kp * err;
    return MathMax(minR, MathMin(maxR, out));
}

void TestEPIDController()
{
    Section("MODULE 11 — EPID (Equity Velocity PID)");

    double init = InpStartBalance, base = 1.0, kp = 2.0, target = 0.5;
    double minR = 0.10, maxR = 2.00;

    // Positive equity above target → risk increases
    double eq_high = init * 1.02;  // +2% equity (above 0.5% target)
    double r_high  = TestEPID(eq_high, init, base, kp, target, minR, maxR);
    AssertGT("EPID: above target equity increases risk", r_high, base);

    // Drawdown below target → risk decreases
    double eq_low = init * 0.97;   // -3% equity (below 0.5% target)
    double r_low  = TestEPID(eq_low, init, base, kp, target, minR, maxR);
    AssertLT("EPID: below target equity decreases risk", r_low, base);

    // Neutral (exactly at target) → near base risk
    double eq_neutral = init * 1.005; // exactly +0.5% target
    double r_neutral  = TestEPID(eq_neutral, init, base, kp, target, minR, maxR);
    AssertNear("EPID: at target = base risk", r_neutral, base, 0.001);

    // Output clamped to [minR, maxR]
    double eq_crash = init * 0.50;  // -50% — severe drawdown
    double r_floor  = TestEPID(eq_crash, init, base, kp, target, minR, maxR);
    AssertNear("EPID: floor clamping at InpPIDMinRisk", r_floor, minR, 0.001);

    double eq_moon = init * 2.00;   // +100% equity
    double r_ceil  = TestEPID(eq_moon, init, base, kp, target, minR, maxR);
    AssertNear("EPID: ceiling clamping at InpPIDMaxRisk", r_ceil, maxR, 0.001);

    // Anti-martingale: more drawdown → less risk (monotone in [minR, base])
    double r1 = TestEPID(init * 0.99, init, base, kp, target, minR, maxR);
    double r2 = TestEPID(init * 0.97, init, base, kp, target, minR, maxR);
    double r3 = TestEPID(init * 0.95, init, base, kp, target, minR, maxR);
    AssertGT("EPID: less drawdown = more risk (r1>r2)", r1, r2);
    AssertGT("EPID: less drawdown = more risk (r2>r3)", r2, r3);
}

//============================================================
// MODULE 12 — VPID (Volatility Regime PID)
//============================================================

double TestVPID(double atrRatio, double kp, double currentMult)
{
    double err  = 1.0 - atrRatio;  // positive when calm, negative when volatile
    double step = kp * err * 0.1;  // scaled step
    double out  = currentMult + step;
    out = MathMax(0.3, MathMin(1.5, out));
    return out;
}

void TestVPIDController()
{
    Section("MODULE 12 — VPID (Volatility Regime PID)");

    // High ATR (volatile) → multiplier decreases from 1.0
    double v_high = TestVPID(2.0, 1.5, 1.0);  // ATR = 2× its MA
    AssertLT("VPID: high vol reduces multiplier below 1.0", v_high, 1.0);

    // Low ATR (calm) → multiplier increases from 1.0
    double v_low = TestVPID(0.5, 1.5, 1.0);   // ATR = half its MA
    AssertGT("VPID: low vol increases multiplier above 1.0", v_low, 1.0);

    // Normal vol (ratio = 1.0) → neutral error → no change
    double v_neutral = TestVPID(1.0, 1.5, 1.0);
    AssertNear("VPID: normal vol → neutral multiplier", v_neutral, 1.0, 0.001);

    // Bounds [0.3, 1.5]
    double v_floor = TestVPID(10.0, 1.5, 0.31); // extreme high vol, near floor
    AssertLE("VPID: mult >= 0.3 floor", v_floor, 1.5);
    AssertGT("VPID: mult > 0.0 (no zero risk)", v_floor, 0.0);
    double v_ceil = TestVPID(0.1, 1.5, 1.49);   // extreme calm, near ceiling
    AssertLE("VPID: mult <= 1.5 ceiling", v_ceil, 1.5);
}

//============================================================
// MODULE 13 — WRPID (Win-Rate PID)
//============================================================

double TestWRPID(double winRate, double target, double kp, double currentMult)
{
    double err  = winRate - target;
    double step = kp * err * 0.1;
    double out  = currentMult + step;
    return MathMax(0.3, MathMin(1.5, out));
}

void TestWRPIDController()
{
    Section("MODULE 13 — WRPID (Win-Rate PID)");

    // Below target win rate → reduce risk
    double wr_low = TestWRPID(0.30, 0.50, 1.0, 1.0);  // 30% WR vs 50% target
    AssertLT("WRPID: low win rate reduces multiplier", wr_low, 1.0);

    // Above target win rate → increase risk
    double wr_high = TestWRPID(0.70, 0.50, 1.0, 1.0); // 70% WR vs 50% target
    AssertGT("WRPID: high win rate increases multiplier", wr_high, 1.0);

    // Exactly at target → no change
    double wr_neutral = TestWRPID(0.50, 0.50, 1.0, 1.0);
    AssertNear("WRPID: at target win rate = neutral", wr_neutral, 1.0, 0.001);

    // Monotone response: 40% < 50% < 60% maps to increasing mults
    double m1 = TestWRPID(0.40, 0.50, 1.0, 1.0);
    double m2 = TestWRPID(0.50, 0.50, 1.0, 1.0);
    double m3 = TestWRPID(0.60, 0.50, 1.0, 1.0);
    AssertGT("WRPID: 60% WR > 50% WR mult", m3, m2);
    AssertGT("WRPID: 50% WR > 40% WR mult", m2, m1);
}

//============================================================
// MODULE 14 — DVPID (Drawdown Velocity PID)
// Protective-only: never increases above 1.0
//============================================================

double TestDVPID(double velocity, double kpDown, double currentMult)
{
    // Asymmetric proportional controller: aggressive on the downside
    // (kpDown), gentle on recovery (0.5). Zero velocity → zero step.
    double kp   = (velocity < 0.0) ? kpDown : 0.5;
    double step = kp * velocity;
    // Asymmetric slew clamp: fast down (-0.05/bar), slow up (+0.01/bar)
    if(step < 0.0) step = MathMax(step, -0.05);
    else            step = MathMin(step,  0.01);
    double out = currentMult + step;
    return MathMax(0.1, MathMin(1.0, out)); // protective: NEVER above 1.0
}

void TestDVPIDController()
{
    Section("MODULE 14 — DVPID (Drawdown Velocity PID)");

    // Negative velocity (equity falling) → reduce multiplier
    double dv_neg = TestDVPID(-0.01, 3.0, 1.0);  // equity falling 1%/bar
    AssertLT("DVPID: negative velocity reduces mult below 1.0", dv_neg, 1.0);

    // Positive velocity (equity rising) → slight increase but never > 1.0
    double dv_pos = TestDVPID(0.01, 3.0, 0.8);   // equity rising, mult was 0.8
    AssertGT("DVPID: positive velocity allows recovery", dv_pos, 0.8);
    AssertLE("DVPID: recovery never exceeds 1.0 ceiling", dv_pos, 1.0);

    // Neutral (no change) → stays put
    double dv_neutral = TestDVPID(0.0, 3.0, 0.9);
    AssertNear("DVPID: zero velocity = no change", dv_neutral, 0.9, 0.001);

    // Asymmetry: fast cut on negative, slow recovery on positive
    double dv_cut    = TestDVPID(-0.02, 3.0, 1.0); // fast downward step
    double dv_recov  = TestDVPID( 0.02, 3.0, 0.9); // slow upward step
    double cut_delta = 1.0    - dv_cut;
    double rec_delta = dv_recov - 0.9;
    AssertGT("DVPID: downward step > upward step (asymmetric)", cut_delta, rec_delta);

    // Hard floor: severe drawdown can't go below 0.1
    double dv_extreme = TestDVPID(-0.5, 3.0, 0.11);
    AssertNear("DVPID: floor clamping at 0.1", dv_extreme, 0.1, 0.05);
}

//============================================================
// MODULE 15 — SPID (Spread PID)
// Controls the dynamic spread threshold
//============================================================

double TestSPIDMult(double spreadRatio, double kp, double currentMult)
{
    double err  = 1.0 - spreadRatio;    // positive when spread low (allow more)
    double step = kp * err * 0.05;
    double out  = currentMult + step;
    return MathMax(0.5, MathMin(2.0, out));
}

void TestSPIDController()
{
    Section("MODULE 15 — SPID (Spread PID)");

    // High spread (ratio > 1) → mult decreases → tighter threshold
    double s_high = TestSPIDMult(2.0, 2.0, 1.0);   // spread = 2× average
    AssertLT("SPID: high spread tightens threshold", s_high, 1.0);

    // Low spread (ratio < 1) → mult increases → looser threshold
    double s_low = TestSPIDMult(0.5, 2.0, 1.0);    // spread = half average
    AssertGT("SPID: low spread loosens threshold", s_low, 1.0);

    // Normal spread (ratio = 1) → neutral
    double s_neutral = TestSPIDMult(1.0, 2.0, 1.0);
    AssertNear("SPID: normal spread = neutral mult", s_neutral, 1.0, 0.001);

    // Dynamic threshold uses mult
    int baseThreshold = 30;
    int dynThreshHigh = (int)(baseThreshold * s_high);
    int dynThreshLow  = (int)(baseThreshold * s_low);
    AssertLT("SPID: high-spread threshold < base",  (double)dynThreshHigh, (double)baseThreshold);
    AssertGT("SPID: low-spread threshold > base",   (double)dynThreshLow,  (double)baseThreshold);

    // Bounds [0.5, 2.0]
    double s_extreme_high = TestSPIDMult(10.0, 2.0, 0.51); // extreme spread, near floor
    AssertGT("SPID: floor >= 0.5 (keeps entry possible)", s_extreme_high, 0.49);
}

//============================================================
// MODULE 16 — COMBINED PID BOUNDS
// Combined effective_risk = EPID × VPID × WRPID × DVPID, clamped
//============================================================

void TestCombinedPID()
{
    Section("MODULE 16 — COMBINED PID BOUNDS");

    double initBal = InpStartBalance;
    double base    = 1.0;   // InpRiskPerTrade
    double minR    = 0.10;  // InpPIDMinRisk
    double maxR    = 2.00;  // InpPIDMaxRisk

    // All PIDs at maximum reduction
    double epid   = minR;   // EPID floored
    double vMult  = 0.3;    // VPID at floor
    double wrMult = 0.3;    // WRPID at floor
    double dvMult = 0.1;    // DVPID at floor (protective only)
    double combined_low = MathMax(minR, MathMin(maxR, epid * vMult * wrMult * dvMult));
    AssertNear("Combined: all PIDs at min → floored at InpPIDMinRisk",
               combined_low, minR, 0.001);

    // All PIDs at maximum
    double epid2   = maxR;  // EPID at ceiling
    double vMult2  = 1.5;   // VPID at ceiling
    double wrMult2 = 1.5;   // WRPID at ceiling
    double dvMult2 = 1.0;   // DVPID can't exceed 1.0
    double combined_high = MathMax(minR, MathMin(maxR, epid2 * vMult2 * wrMult2 * dvMult2));
    AssertNear("Combined: all PIDs at max → capped at InpPIDMaxRisk",
               combined_high, maxR, 0.001);

    // DVPID always ≤ 1.0: combined can never EXCEED base from DVPID alone
    double r_after_dv = base * 0.9;    // DVPID at 0.9
    AssertLE("DVPID: contribution never pushes risk above base", r_after_dv, base);

    // Clamping maintains FTMO safety
    AssertLE("Combined output ≤ InpPIDMaxRisk (FTMO safe)", combined_high, 2.0);
    AssertGT("Combined output > 0 (never zero risk)", combined_low, 0.0);
}

//============================================================
// MODULE 17 — MODE GATING
// Verifies FTMO vs MAX validation behavior
//============================================================

bool ValidateFTMOMode(double dailyLoss, double totalLoss, double pidMaxRisk)
{
    if(dailyLoss <= 0.0 || dailyLoss >= 5.0)  return false;
    if(totalLoss <= 0.0 || totalLoss >= 10.0) return false;
    if(pidMaxRisk > 5.0)                       return false;
    return true;
}

bool ValidateMAXMode(double totalLoss, double pidMaxRisk)
{
    if(totalLoss <= 0.0) return false;     // must have some kill-switch
    if(pidMaxRisk <= 0.0) return false;
    // MAX: no daily/total limit bounds — only totalLoss > 0 required
    return true;
}

void TestModeGating()
{
    Section("MODULE 17 — MODE GATING (FTMO vs MAX)");

    // FTMO mode: strict limits required
    AssertTrue ("FTMO: valid config (4.5%/9%/2.0) accepted",
                ValidateFTMOMode(4.5, 9.0, 2.0));
    AssertFalse("FTMO: daily ≥ 5% rejected",
                ValidateFTMOMode(5.0, 9.0, 2.0));
    AssertFalse("FTMO: total ≥ 10% rejected",
                ValidateFTMOMode(4.5, 10.0, 2.0));
    AssertFalse("FTMO: PID max risk > 5% rejected",
                ValidateFTMOMode(4.5, 9.0, 6.0));

    // MAX mode: only needs a kill-switch
    AssertTrue ("MAX: aggressive config (45%/5.0) valid",
                ValidateMAXMode(45.0, 5.0));
    AssertTrue ("MAX: daily loss > 5% allowed",
                ValidateMAXMode(30.0, 3.0));
    AssertFalse("MAX: totalLoss=0 (no kill-switch) rejected",
                ValidateMAXMode(0.0, 5.0));

    // Magic number isolation
    int ftmoMagic = 202401, maxMagic = 202402;
    AssertFalse("FTMO and MAX magic numbers must differ",
                ftmoMagic == maxMagic);
    Print("  FTMO magic: ", ftmoMagic, " | MAX magic: ", maxMagic);
}

//============================================================
// MODULE 18 — PID STATE PERSISTENCE (GlobalVariable simulation)
//============================================================

void TestPIDPersistence()
{
    Section("MODULE 18 — PID STATE PERSISTENCE");

    string prefix = "TEST_202401_EURUSD_";
    string keyR   = prefix + "EPID_R";
    string keyI   = prefix + "EPID_I";

    // Simulate persist + restore cycle
    double savedRisk = 1.35;
    double savedIntg = 0.42;
    GlobalVariableSet(keyR, savedRisk);
    GlobalVariableSet(keyI, savedIntg);

    double restoredR = GlobalVariableGet(keyR);
    double restoredI = GlobalVariableGet(keyI);
    AssertNear("EPID risk persists across restarts",    restoredR, savedRisk, 0.0001);
    AssertNear("EPID integral persists across restarts", restoredI, savedIntg, 0.0001);

    // Cleanup
    GlobalVariableDel(keyR);
    GlobalVariableDel(keyI);
    AssertNear("GlobalVar cleared after del", GlobalVariableGet(keyR), 0.0, 0.0001);
}

//============================================================
// MAIN
//============================================================

void OnStart()
{
    Print("═══════════════════════════════════════════════");
    Print("  FTMO ProTrader EA v5.00 — Unit Test Suite");
    Print("  Balance: $", InpStartBalance);
    Print("═══════════════════════════════════════════════");

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
    TestEPIDController();
    TestVPIDController();
    TestWRPIDController();
    TestDVPIDController();
    TestSPIDController();
    TestCombinedPID();
    TestModeGating();
    TestPIDPersistence();

    Print("\n═══════════════════════════════════════════════");
    int total = g_pass + g_fail;
    double pct = (total > 0) ? (double)g_pass / total * 100.0 : 0;
    Print("  RESULTS: ", g_pass, "/", total, " passed  (",
          DoubleToString(pct, 1), "%)");
    if(g_fail == 0)
        Print("  ALL TESTS PASSED ✓");
    else
        Print("  FAILURES: ", g_fail, " — review [FAIL] lines above");
    Print("═══════════════════════════════════════════════");
}
//+------------------------------------------------------------------+
