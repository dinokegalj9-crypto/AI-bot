//+------------------------------------------------------------------+
//|                        ProTrader_PIDs.mqh                        |
//|          PID Risk-Controller Library — FTMO ProTrader EA         |
//|                                                                  |
//|  Five independent PID controllers + combined API.               |
//|  All `input` declarations live in the wrapper .mq5 file.        |
//|  This file uses only names injected at include-time.            |
//|                                                                  |
//|  Required inputs (declare in wrapper before #include):          |
//|                                                                  |
//|  — Master gate —                                                 |
//|    bool   InpPIDEnabled                                          |
//|    double InpRiskPerTrade    (fallback when PID disabled)        |
//|    double InpPIDMinRisk      (absolute lower bound, % of bal)   |
//|    double InpPIDMaxRisk      (absolute upper bound, % of bal)   |
//|    double InpPIDDeadband     (error dead-zone, dimensionless)   |
//|    double InpPIDMaxStep      (EPID slew rate per bar, %)        |
//|    double InpPIDDerivFilter  (EPID deriv LP alpha, 0-1)         |
//|                                                                  |
//|  — EPID —                                                        |
//|    double InpEPIDTarget      (daily profit target %)            |
//|    double InpEPIDKp                                              |
//|    double InpEPIDKi                                              |
//|    double InpEPIDKd                                              |
//|                                                                  |
//|  — VPID —                                                        |
//|    bool   InpVPIDEnabled                                         |
//|    int    InpVPIDATRMA       (ATR MA window, ≤50)               |
//|    double InpVPIDKp                                              |
//|    double InpVPIDKi                                              |
//|                                                                  |
//|  — WRPID —                                                       |
//|    bool   InpWRPIDEnabled                                        |
//|    int    InpWRPIDWindow     (rolling trade window, ≤100)       |
//|    double InpWRPIDTarget     (target win-rate %)                |
//|    double InpWRPIDKp                                             |
//|    double InpWRPIDKi                                             |
//|                                                                  |
//|  — DVPID —                                                       |
//|    bool   InpDVPIDEnabled                                        |
//|    int    InpDVPIDWindow     (equity velocity window, ≤32)      |
//|    double InpDVPIDKp         (downside gain; upside = 0.5)      |
//|                                                                  |
//|  — SPID —                                                        |
//|    bool   InpSPIDEnabled                                         |
//|    int    InpSPIDWindow      (spread rolling window, ≤200)      |
//|    double InpSPIDKp           (P-only controller)              |
//|    int    InpMaxSpreadPoints (base spread gate)                  |
//+------------------------------------------------------------------+
#ifndef PROTRADER_PIDS_MQH
#define PROTRADER_PIDS_MQH

//===================================================================
// BUFFER SIZE CONSTANTS — compile-time literals, never computed
//===================================================================
#define VPID_ATR_BUF_MAX     50
#define WRPID_TRADE_BUF_MAX 100
#define DVPID_EQ_BUF_MAX     32
#define SPID_SPREAD_BUF_MAX 200

//===================================================================
// SECTION 1 — UTILITY HELPERS
//===================================================================

//--- Saturating clamp — avoids branchy inline ternaries everywhere
double PID_Clamp(double v, double lo, double hi)
{
    if(v < lo) return lo;
    if(v > hi) return hi;
    return v;
}

//--- Safe division — returns `fallback` when denominator is effectively zero
double PID_SafeDiv(double num, double den, double fallback = 0.0)
{
    if(MathAbs(den) < 1e-15) return fallback;
    return num / den;
}

//===================================================================
// SECTION 2 — EPID  (Equity Velocity PID)
//
//   Measurement : filtered equity ratio = (equity / initialBalance) - 1.0
//   Setpoint    : InpEPIDTarget / 100.0  (daily profit target as fraction)
//   Error       : measurement - setpoint
//                 positive  → above target  → increase risk
//                 negative  → in drawdown   → reduce risk
//   Output      : absolute effective risk % clamped to
//                 [InpPIDMinRisk, InpPIDMaxRisk]
//
//   Features    : filtered derivative (1st-order LP, alpha=InpPIDDerivFilter)
//                 deadband (InpPIDDeadband)
//                 slew rate (InpPIDMaxStep per bar)
//                 anti-windup (restore integral on saturation)
//                 3-sample equity noise filter
//                 GlobalVariable persistence ("prefix" + "EPID_R/I")
//===================================================================

static double s_epid_integral   = 0.0;   // accumulated integral term
static double s_epid_prevErr    = 0.0;   // previous error for derivative
static double s_epid_prevDeriv  = 0.0;   // filtered derivative state
static double s_epid_output     = 0.0;   // last clamped output (% risk)

// 3-sample equity ring buffer for single-tick noise rejection
static double s_epid_eqBuf[3]   = {0.0, 0.0, 0.0};
static int    s_epid_eqIdx       = 0;    // next write position
static int    s_epid_eqFilled    = 0;    // how many valid samples (0-3)

// GlobalVariable name cache (set once in EPID_Init)
static string s_epid_gv_R        = "";   // persists output
static string s_epid_gv_I        = "";   // persists integral

//--------------------------------------------------------------------
// EPID_Init — restore persisted state or seed from baseRisk
//--------------------------------------------------------------------
void EPID_Init(double baseRisk, string gvPrefix)
{
    s_epid_gv_R = gvPrefix + "EPID_R";
    s_epid_gv_I = gvPrefix + "EPID_I";

    // Attempt to restore persisted output — fall back to baseRisk if absent
    double savedR = GlobalVariableGet(s_epid_gv_R);
    double savedI = GlobalVariableGet(s_epid_gv_I);

    s_epid_output   = (savedR > 0.0)
                      ? PID_Clamp(savedR, InpPIDMinRisk, InpPIDMaxRisk)
                      : PID_Clamp(baseRisk, InpPIDMinRisk, InpPIDMaxRisk);
    s_epid_integral = savedI;  // GlobalVariableGet returns 0.0 when absent

    s_epid_prevErr   = 0.0;
    s_epid_prevDeriv = 0.0;
    for(int i = 0; i < 3; i++) s_epid_eqBuf[i] = 0.0;
    s_epid_eqIdx    = 0;
    s_epid_eqFilled = 0;
}

//--------------------------------------------------------------------
// EPID_FilteredEquityRatio — push raw ratio into 3-sample ring,
// return mean of available samples (1-3 bars)
//--------------------------------------------------------------------
double EPID_FilteredEquityRatio(double equity, double initialBalance)
{
    if(initialBalance <= 0.0) return 0.0;

    double rawRatio = equity / initialBalance - 1.0;

    // Write into circular buffer
    s_epid_eqBuf[s_epid_eqIdx] = rawRatio;
    s_epid_eqIdx = (s_epid_eqIdx + 1) % 3;
    if(s_epid_eqFilled < 3) s_epid_eqFilled++;

    // Mean of filled slots
    double sum = 0.0;
    for(int i = 0; i < s_epid_eqFilled; i++) sum += s_epid_eqBuf[i];
    return PID_SafeDiv(sum, (double)s_epid_eqFilled, rawRatio);
}

//--------------------------------------------------------------------
// EPID_Update — main controller step, call once per bar
//--------------------------------------------------------------------
double EPID_Update(double equity, double initialBalance)
{
    double measurement = EPID_FilteredEquityRatio(equity, initialBalance);
    double setpoint    = InpEPIDTarget / 100.0;
    double error       = measurement - setpoint;

    // Deadband: zero-out error inside the neutral zone
    if(MathAbs(error) < InpPIDDeadband) error = 0.0;

    // Derivative: first-order low-pass filter on raw diff
    double rawDeriv  = error - s_epid_prevErr;
    double alpha     = PID_Clamp(InpPIDDerivFilter, 0.0, 1.0);
    double filtDeriv = alpha * rawDeriv + (1.0 - alpha) * s_epid_prevDeriv;

    // Anti-windup: snapshot integral before accumulating
    double prevIntegral = s_epid_integral;
    s_epid_integral    += error;

    // Incremental (delta) mode: compute the desired CHANGE in risk per bar.
    // Positive error (above target) → delta > 0 → risk increases.
    // Negative error (drawdown)     → delta < 0 → risk decreases.
    double delta = InpEPIDKp * error
                 + InpEPIDKi * s_epid_integral
                 + InpEPIDKd * filtDeriv;

    // Slew-rate limit on the incremental change
    double step = PID_Clamp(delta, -InpPIDMaxStep, InpPIDMaxStep);
    double candidate = s_epid_output + step;

    // Clamp to [MinRisk, MaxRisk]
    double clamped = PID_Clamp(candidate, InpPIDMinRisk, InpPIDMaxRisk);

    // Anti-windup: restore integral when output is saturating
    if(clamped != candidate) s_epid_integral = prevIntegral;

    // Persist state for next bar and across EA restarts
    s_epid_output    = clamped;
    s_epid_prevErr   = error;
    s_epid_prevDeriv = filtDeriv;

    GlobalVariableSet(s_epid_gv_R, s_epid_output);
    GlobalVariableSet(s_epid_gv_I, s_epid_integral);

    return s_epid_output;
}

//--------------------------------------------------------------------
// EPID_DailyReset — clear ALL dynamic state at day rollover
//--------------------------------------------------------------------
void EPID_DailyReset()
{
    s_epid_integral  = 0.0;
    s_epid_prevErr   = 0.0;
    s_epid_prevDeriv = 0.0;
    for(int i = 0; i < 3; i++) s_epid_eqBuf[i] = 0.0;
    s_epid_eqIdx    = 0;
    s_epid_eqFilled = 0;

    // Persist zeroed integral so a mid-day EA restart doesn't resurrect old windup
    GlobalVariableSet(s_epid_gv_I, 0.0);
}

//--------------------------------------------------------------------
// EPID_StatusLine — compact dashboard string (≤40 chars)
//--------------------------------------------------------------------
string EPID_StatusLine()
{
    return StringFormat("EPID: R=%.2f%% I=%.4f", s_epid_output, s_epid_integral);
}

//===================================================================
// SECTION 3 — VPID  (Volatility Regime PID)
//
//   Measurement : currentATR / ATR_MA  (ratio to rolling ATR mean)
//   Setpoint    : 1.0
//   Error       : 1.0 - measurement
//                 positive  → ATR below MA  → calm  → allow more risk
//                 negative  → ATR above MA  → volatile → reduce risk
//   Output      : multiplier clamped to [0.3, 1.5]
//
//   Features    : ring buffer of VPID_ATR_BUF_MAX ATR samples
//                 window = min(InpVPIDATRMA, VPID_ATR_BUF_MAX)
//                 half-deadband (InpPIDDeadband * 0.5)
//                 slew rate 0.05 per bar
//                 anti-windup
//===================================================================

static double s_vpid_atrBuf[VPID_ATR_BUF_MAX];
static int    s_vpid_head    = 0;   // next write slot
static int    s_vpid_count   = 0;   // valid entries (0..VPID_ATR_BUF_MAX)

static double s_vpid_integral = 0.0;
static double s_vpid_output   = 1.0;  // neutral multiplier at startup

//--------------------------------------------------------------------
// VPID_ComputeATR_MA — mean of the newest `window` buffered ATR values
//   Uses the read pattern: newest sample is at (head-1), next is (head-2), ...
//   Safe index: ((head - 1 - i) % MAX + MAX) % MAX
//--------------------------------------------------------------------
double VPID_ComputeATR_MA(int window)
{
    int n = (int)MathMin(s_vpid_count, window);
    if(n == 0) return 0.0;

    double sum = 0.0;
    for(int i = 0; i < n; i++)
    {
        int idx = ((s_vpid_head - 1 - i) % VPID_ATR_BUF_MAX + VPID_ATR_BUF_MAX) % VPID_ATR_BUF_MAX;
        sum += s_vpid_atrBuf[idx];
    }
    return PID_SafeDiv(sum, (double)n, 0.0);
}

void VPID_Init()
{
    for(int i = 0; i < VPID_ATR_BUF_MAX; i++) s_vpid_atrBuf[i] = 0.0;
    s_vpid_head     = 0;
    s_vpid_count    = 0;
    s_vpid_integral = 0.0;
    s_vpid_output   = 1.0;
}

//--------------------------------------------------------------------
// VPID_Update — main controller step, call once per bar
//--------------------------------------------------------------------
double VPID_Update(double currentATR)
{
    if(!InpVPIDEnabled) return 1.0;

    // Push new ATR sample — advance head THEN compute MA (head-1 is newest)
    s_vpid_atrBuf[s_vpid_head] = currentATR;
    s_vpid_head = (s_vpid_head + 1) % VPID_ATR_BUF_MAX;
    if(s_vpid_count < VPID_ATR_BUF_MAX) s_vpid_count++;

    // Window clamped to buffer capacity
    int window = (int)MathMax(1, MathMin((double)InpVPIDATRMA, (double)VPID_ATR_BUF_MAX));

    double atrMA = VPID_ComputeATR_MA(window);

    // If MA not yet available, return neutral
    if(atrMA <= 0.0) return s_vpid_output;

    double measurement = PID_SafeDiv(currentATR, atrMA, 1.0);
    double error       = 1.0 - measurement;

    // Half-deadband for volatility controller
    double deadband = InpPIDDeadband * 0.5;
    if(MathAbs(error) < deadband) error = 0.0;

    // Anti-windup snapshot
    double prevIntegral = s_vpid_integral;
    s_vpid_integral    += error;

    // PI output (no derivative in VPID)
    double pidOut = InpVPIDKp * error + InpVPIDKi * s_vpid_integral;

    // Apply slew: limit change in the multiplier itself to 0.05 per bar
    double delta     = PID_Clamp(pidOut - (s_vpid_output - 1.0), -0.05, 0.05);
    double candidate = s_vpid_output + delta;
    double clamped   = PID_Clamp(candidate, 0.3, 1.5);

    // Anti-windup: restore integral if saturating
    if(clamped != candidate) s_vpid_integral = prevIntegral;

    s_vpid_output = clamped;
    return s_vpid_output;
}

void VPID_DailyReset()
{
    s_vpid_integral = 0.0;
    // Retain ATR history — regime memory is valuable across day boundary
}

string VPID_StatusLine()
{
    if(!InpVPIDEnabled) return "VPID: disabled";
    return StringFormat("VPID: x%.3f n=%d", s_vpid_output, s_vpid_count);
}

//===================================================================
// SECTION 4 — WRPID  (Win-Rate PID)
//
//   Measurement : rolling win-rate over last InpWRPIDWindow trades
//   Setpoint    : InpWRPIDTarget / 100.0
//   Error       : measurement - setpoint
//                 positive  → above target win-rate → allow more risk
//                 negative  → below target           → reduce risk
//   Output      : multiplier clamped to [0.3, 1.5]
//
//   Features    : ring buffer of WRPID_TRADE_BUF_MAX outcomes (0/1)
//                 neutral (1.0) until InpWRPIDWindow/2 trades logged
//                 slew rate 0.05 per bar
//                 anti-windup
//===================================================================

static int    s_wrpid_tradeBuf[WRPID_TRADE_BUF_MAX];
static int    s_wrpid_head     = 0;   // next write slot
static int    s_wrpid_count    = 0;   // total outcomes stored (0..WRPID_TRADE_BUF_MAX)

static double s_wrpid_integral = 0.0;
static double s_wrpid_output   = 1.0;  // neutral multiplier at startup

void WRPID_Init()
{
    for(int i = 0; i < WRPID_TRADE_BUF_MAX; i++) s_wrpid_tradeBuf[i] = 0;
    s_wrpid_head     = 0;
    s_wrpid_count    = 0;
    s_wrpid_integral = 0.0;
    s_wrpid_output   = 1.0;
}

//--------------------------------------------------------------------
// WRPID_AddOutcome — record trade result (call from PID_NotifyTrade)
//--------------------------------------------------------------------
void WRPID_AddOutcome(bool isWin)
{
    s_wrpid_tradeBuf[s_wrpid_head] = isWin ? 1 : 0;
    s_wrpid_head = (s_wrpid_head + 1) % WRPID_TRADE_BUF_MAX;
    if(s_wrpid_count < WRPID_TRADE_BUF_MAX) s_wrpid_count++;
}

//--------------------------------------------------------------------
// WRPID_WinRate — rolling win-rate over the newest `window` trades
//--------------------------------------------------------------------
double WRPID_WinRate(int window)
{
    int n = (int)MathMin(s_wrpid_count, window);
    if(n == 0) return 0.0;

    int wins = 0;
    for(int i = 0; i < n; i++)
    {
        int idx = ((s_wrpid_head - 1 - i) % WRPID_TRADE_BUF_MAX + WRPID_TRADE_BUF_MAX) % WRPID_TRADE_BUF_MAX;
        wins += s_wrpid_tradeBuf[idx];
    }
    return PID_SafeDiv((double)wins, (double)n, 0.0);
}

//--------------------------------------------------------------------
// WRPID_Update — main controller step, call once per bar
//--------------------------------------------------------------------
double WRPID_Update()
{
    if(!InpWRPIDEnabled) return 1.0;

    int window  = (int)MathMax(1, InpWRPIDWindow);
    int halfWin = window / 2;

    // Return neutral until at least half a window of trades recorded
    if(s_wrpid_count < halfWin) return 1.0;

    double measurement = WRPID_WinRate(window);
    double error       = measurement - (InpWRPIDTarget / 100.0);

    // Anti-windup snapshot
    double prevIntegral = s_wrpid_integral;
    s_wrpid_integral   += error;

    // PI output
    double pidOut = InpWRPIDKp * error + InpWRPIDKi * s_wrpid_integral;

    // Apply slew: limit change in multiplier to 0.05 per bar
    double delta     = PID_Clamp(pidOut - (s_wrpid_output - 1.0), -0.05, 0.05);
    double candidate = s_wrpid_output + delta;
    double clamped   = PID_Clamp(candidate, 0.3, 1.5);

    // Anti-windup
    if(clamped != candidate) s_wrpid_integral = prevIntegral;

    s_wrpid_output = clamped;
    return s_wrpid_output;
}

void WRPID_DailyReset()
{
    s_wrpid_integral = 0.0;
    // Retain trade history — win-rate memory is meaningful across days
}

string WRPID_StatusLine()
{
    if(!InpWRPIDEnabled) return "WRPID: disabled";
    int    window = (int)MathMax(1, InpWRPIDWindow);
    double wr     = WRPID_WinRate(window);
    return StringFormat("WRPID: x%.3f WR=%.0f%%", s_wrpid_output, wr * 100.0);
}

//===================================================================
// SECTION 5 — DVPID  (Drawdown Velocity PID)
//
//   Measurement : equity velocity = (eq[now] - eq[now-window]) /
//                                   (initialBalance * window)
//                 normalised per-bar fractional move
//   Output      : multiplier clamped to [0.1, 1.0]
//                 NEVER increases above 1.0 — protective only
//
//   Features    : ring buffer of DVPID_EQ_BUF_MAX equity snapshots
//                 asymmetric gains: Kp_down=InpDVPIDKp, Kp_up=0.5
//                 asymmetric slew: down 5% per bar, up 1% per bar
//===================================================================

static double s_dvpid_eqBuf[DVPID_EQ_BUF_MAX];
static int    s_dvpid_head   = 0;   // next write slot
static int    s_dvpid_count  = 0;   // valid entries (0..DVPID_EQ_BUF_MAX)

static double s_dvpid_output = 1.0;  // start permissive; DVPID only cuts

void DVPID_Init()
{
    for(int i = 0; i < DVPID_EQ_BUF_MAX; i++) s_dvpid_eqBuf[i] = 0.0;
    s_dvpid_head   = 0;
    s_dvpid_count  = 0;
    s_dvpid_output = 1.0;
}

//--------------------------------------------------------------------
// DVPID_Update — main controller step, call once per bar
//--------------------------------------------------------------------
double DVPID_Update(double equity, double initialBalance)
{
    if(!InpDVPIDEnabled) return 1.0;

    // Push equity snapshot
    s_dvpid_eqBuf[s_dvpid_head] = equity;
    s_dvpid_head = (s_dvpid_head + 1) % DVPID_EQ_BUF_MAX;
    if(s_dvpid_count < DVPID_EQ_BUF_MAX) s_dvpid_count++;

    int window = (int)MathMax(1, MathMin((double)InpDVPIDWindow, (double)DVPID_EQ_BUF_MAX));

    // Need at least window+1 distinct snapshots for a velocity estimate
    if(s_dvpid_count <= window) return s_dvpid_output;

    // Newest sample is at (head-1), sample `window` bars back is at (head-1-window)
    int idxNow  = ((s_dvpid_head - 1)          % DVPID_EQ_BUF_MAX + DVPID_EQ_BUF_MAX) % DVPID_EQ_BUF_MAX;
    int idxBack = ((s_dvpid_head - 1 - window) % DVPID_EQ_BUF_MAX + DVPID_EQ_BUF_MAX) % DVPID_EQ_BUF_MAX;

    double eqNow   = s_dvpid_eqBuf[idxNow];
    double eqBack  = s_dvpid_eqBuf[idxBack];

    // velocity: signed fractional change per bar, normalised to initial balance
    double denom   = initialBalance * (double)window;
    double velocity = PID_SafeDiv(eqNow - eqBack, denom, 0.0);

    double step;
    if(velocity < 0.0)
    {
        // Drawdown branch: large proportional cut, fast slew (up to -5% per bar)
        double correction = InpDVPIDKp * MathAbs(velocity);
        step = PID_Clamp(-correction, -0.05, 0.0);
    }
    else
    {
        // Recovery branch: conservative proportional lift, slow slew (up to +1% per bar)
        double correction = 0.5 * velocity;
        step = PID_Clamp(correction, 0.0, 0.01);
    }

    double candidate = s_dvpid_output + step;
    // Hard ceiling at 1.0 — DVPID is protective, never amplifying
    s_dvpid_output = PID_Clamp(candidate, 0.1, 1.0);

    return s_dvpid_output;
}

void DVPID_DailyReset()
{
    // Do NOT clear equity history — drawdown memory must persist across day
    // boundary so a sharp overnight gap still triggers protection
}

string DVPID_StatusLine()
{
    if(!InpDVPIDEnabled) return "DVPID: disabled";
    return StringFormat("DVPID: x%.3f n=%d", s_dvpid_output, s_dvpid_count);
}

//===================================================================
// SECTION 6 — SPID  (Spread PID)
//
//   Measurement : currentSpread / rollingAverageSpread
//   Setpoint    : 1.0
//   Error       : 1.0 - measurement
//                 positive  → spread below avg → calm   → widen threshold
//                 negative  → spread above avg → spikey → tighten threshold
//   Output      : spread threshold multiplier clamped to [0.5, 2.0]
//
//   Exposes     : SPID_MaxSpread() → (int)(InpMaxSpreadPoints * mult)
//
//   Features    : ring buffer of SPID_SPREAD_BUF_MAX spread samples
//                 slew rate 0.05 per sample
//                 anti-windup
//===================================================================

static double s_spid_spreadBuf[SPID_SPREAD_BUF_MAX];
static int    s_spid_head      = 0;   // next write slot
static int    s_spid_count     = 0;   // valid entries (0..SPID_SPREAD_BUF_MAX)

static double s_spid_mult      = 1.0;  // current spread threshold multiplier

void SPID_Init()
{
    for(int i = 0; i < SPID_SPREAD_BUF_MAX; i++) s_spid_spreadBuf[i] = 0.0;
    s_spid_head  = 0;
    s_spid_count = 0;
    s_spid_mult  = 1.0;
}

//--------------------------------------------------------------------
// SPID_Update — call once per bar (or tick) with current spread in points
//--------------------------------------------------------------------
double SPID_Update(double currentSpread)
{
    if(!InpSPIDEnabled) return 1.0;

    // Push spread sample
    s_spid_spreadBuf[s_spid_head] = currentSpread;
    s_spid_head = (s_spid_head + 1) % SPID_SPREAD_BUF_MAX;
    if(s_spid_count < SPID_SPREAD_BUF_MAX) s_spid_count++;

    // Rolling average over the configured window (clamped to buffer max)
    int window = (int)MathMax(1, MathMin((double)InpSPIDWindow, (double)SPID_SPREAD_BUF_MAX));
    int n      = (int)MathMin(s_spid_count, window);

    double sumSpread = 0.0;
    for(int i = 0; i < n; i++)
    {
        int idx = ((s_spid_head - 1 - i) % SPID_SPREAD_BUF_MAX + SPID_SPREAD_BUF_MAX) % SPID_SPREAD_BUF_MAX;
        sumSpread += s_spid_spreadBuf[idx];
    }
    double avgSpread = PID_SafeDiv(sumSpread, (double)n, currentSpread);

    double measurement = PID_SafeDiv(currentSpread, avgSpread, 1.0);
    double error       = 1.0 - measurement;  // positive when spread calm

    // Proportional output (P-only: spread ratio is already self-normalising,
    // so an integral term would only add windup with no steady-state benefit)
    double pidOut = InpSPIDKp * error;

    // Apply slew: limit change in multiplier to 0.05 per sample
    double delta     = PID_Clamp(pidOut - (s_spid_mult - 1.0), -0.05, 0.05);
    double candidate = s_spid_mult + delta;
    s_spid_mult      = PID_Clamp(candidate, 0.5, 2.0);
    return s_spid_mult;
}

//--------------------------------------------------------------------
// SPID_MaxSpread — dynamic spread gate in points
//--------------------------------------------------------------------
int SPID_MaxSpread()
{
    return (int)(InpMaxSpreadPoints * s_spid_mult);
}

void SPID_DailyReset()
{
    // P-only controller — no integral state to clear.
    // Spread history is intentionally retained for MA continuity.
}

string SPID_StatusLine()
{
    if(!InpSPIDEnabled) return "SPID: disabled";
    return StringFormat("SPID: x%.3f max=%d", s_spid_mult, SPID_MaxSpread());
}

//===================================================================
// SECTION 7 — COMBINED API
//===================================================================

//--------------------------------------------------------------------
// PID_InitAll — initialise all five controllers.
//   baseRisk : seed value for EPID (typically InpRiskPerTrade)
//   gvPrefix : GlobalVariable prefix (e.g. "PT_" to avoid collision)
//--------------------------------------------------------------------
void PID_InitAll(double baseRisk, string gvPrefix)
{
    EPID_Init(baseRisk, gvPrefix);
    VPID_Init();
    WRPID_Init();
    DVPID_Init();
    SPID_Init();
}

//--------------------------------------------------------------------
// PID_GetEffectiveRisk — master risk query, call once per bar.
//
//   Returns: clamp(EPID × VPID × WRPID × DVPID, InpPIDMinRisk, InpPIDMaxRisk)
//   Falls back to InpRiskPerTrade when InpPIDEnabled == false.
//
//   NOTE: SPID is not part of the risk multiplication; it governs the
//         spread gate only (use SPID_MaxSpread() in the order entry).
//         SPID_Update() is called here to keep its state fresh even
//         when the EA is not opening new positions.
//--------------------------------------------------------------------
static double s_pid_lastEff = 0.0;   // last composite effective risk (for logging)

double PID_GetEffectiveRisk(double equity, double initialBalance, double currentATR)
{
    if(!InpPIDEnabled)
    {
        s_pid_lastEff = InpRiskPerTrade;
        return InpRiskPerTrade;
    }

    double epid  = EPID_Update(equity, initialBalance);
    double vpid  = VPID_Update(currentATR);
    double wrpid = WRPID_Update();
    double dvpid = DVPID_Update(equity, initialBalance);

    double composite = epid * vpid * wrpid * dvpid;
    s_pid_lastEff = PID_Clamp(composite, InpPIDMinRisk, InpPIDMaxRisk);
    return s_pid_lastEff;
}

//--------------------------------------------------------------------
// PID_LastEffectiveRisk — last composite risk % computed by
// PID_GetEffectiveRisk (cached; no recompute). Used for trade logging.
//--------------------------------------------------------------------
double PID_LastEffectiveRisk()
{
    return (s_pid_lastEff > 0.0) ? s_pid_lastEff : InpRiskPerTrade;
}

//--------------------------------------------------------------------
// PID_NotifyTrade — record closed-trade outcome.
//   Call from OnTradeTransaction when a position closes.
//--------------------------------------------------------------------
void PID_NotifyTrade(bool isWin)
{
    WRPID_AddOutcome(isWin);
}

//--------------------------------------------------------------------
// PID_DailyReset — perform all day-rollover resets.
//   Call at the same point you roll over the FTMO daily reference.
//--------------------------------------------------------------------
void PID_DailyReset()
{
    EPID_DailyReset();
    VPID_DailyReset();
    WRPID_DailyReset();
    DVPID_DailyReset();
    SPID_DailyReset();
}

//--------------------------------------------------------------------
// PID_StatusBlock — multi-line status for dashboard display.
//   Lines separated by '\n'; each line ≤40 chars.
//--------------------------------------------------------------------
string PID_StatusBlock()
{
    if(!InpPIDEnabled)
        return "PID: disabled (fixed risk mode)";

    return EPID_StatusLine()  + "\n" +
           VPID_StatusLine()  + "\n" +
           WRPID_StatusLine() + "\n" +
           DVPID_StatusLine() + "\n" +
           SPID_StatusLine();
}

#endif // PROTRADER_PIDS_MQH
//+------------------------------------------------------------------+
