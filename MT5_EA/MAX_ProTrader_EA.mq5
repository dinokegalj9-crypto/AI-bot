//+------------------------------------------------------------------+
//|                                             MAX_ProTrader_EA.mq5 |
//+------------------------------------------------------------------+
#property copyright "MAX ProTrader EA"
#property link      ""
#property version   "5.00"
#property description "MAX (Uncapped) Professional Expert Advisor with 5 PID Controllers"

//+------------------------------------------------------------------+
//| Standard Library Includes                                        |
//+------------------------------------------------------------------+
#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>
#include <Trade\OrderInfo.mqh>

//+------------------------------------------------------------------+
//| ════════ EA MODE ════════                                        |
//+------------------------------------------------------------------+
input bool   InpFTMOMode           = false;   // true = FTMO rules enforced strictly
input bool   InpEnforceDailyLimit  = false;   // Halt on daily loss limit
input bool   InpEnforceTotalLimit  = true;    // Halt on total drawdown limit
input bool   InpEnforceProfitStop  = false;   // Halt on profit target reached

//+------------------------------------------------------------------+
//| ════════ FTMO RISK MANAGEMENT ════════                           |
//+------------------------------------------------------------------+
input double InpRiskPerTrade       = 2.0;     // Base risk per trade (% of balance)
input double InpMaxDailyLoss       = 8.0;     // Max daily loss % [not enforced, stored only]
input double InpMaxTotalLoss       = 45.0;    // Max total drawdown % [50% kill-switch]
input double InpProfitTarget       = 50.0;    // Profit target % [not enforced, tracked only]
input int    InpMinTradingDays     = 4;       // Minimum required trading days

//+------------------------------------------------------------------+
//| ════════ STRATEGY PARAMETERS ════════                            |
//+------------------------------------------------------------------+
input ENUM_TIMEFRAMES InpMainTF    = PERIOD_H1;   // Primary signal timeframe
input ENUM_TIMEFRAMES InpTrendTF   = PERIOD_H4;   // Trend filter timeframe
input int    InpFastEMA            = 20;      // Fast EMA period
input int    InpSlowEMA            = 50;      // Slow EMA period
input int    InpTrendEMA           = 200;     // Trend EMA period
input int    InpRSIPeriod          = 14;      // RSI period
input double InpRSIOverbought      = 65.0;    // RSI overbought threshold
input double InpRSIOversold        = 35.0;    // RSI oversold threshold
input int    InpMACDFast           = 12;      // MACD fast period
input int    InpMACDSlow           = 26;      // MACD slow period
input int    InpMACDSignal         = 9;       // MACD signal period
input int    InpATRPeriod          = 14;      // ATR period
input double InpATRSLMulti         = 1.5;     // ATR stop loss multiplier
input double InpATRTPMulti         = 2.5;     // ATR take profit multiplier
input int    InpMinSignals         = 4;       // Min confluence signals to trade (3-5)

//+------------------------------------------------------------------+
//| ════════ TRADE MANAGEMENT ════════                               |
//+------------------------------------------------------------------+
input int    InpMaxTrades          = 5;       // Max simultaneous open trades
input bool   InpUseBreakeven       = true;    // Use breakeven stop
input double InpBEAtRR             = 1.0;     // Move to breakeven at R:R ratio
input bool   InpUseTrailing        = true;    // Use trailing stop
input double InpTrailATRMulti      = 1.0;     // Trailing stop ATR multiplier
input int    InpMaxSpreadPoints    = 30;      // Max spread (points) base threshold
input int    InpMagicNumber        = 202402;  // EA magic number

//+------------------------------------------------------------------+
//| ════════ SESSION FILTER ════════                                 |
//+------------------------------------------------------------------+
input bool   InpUseLondon          = true;    // Trade London session (08:00-16:00 GMT)
input bool   InpUseNewYork         = true;    // Trade New York session (13:00-21:00 GMT)
input int    InpGMTOffset          = 0;       // Broker GMT offset (hours)

//+------------------------------------------------------------------+
//| ════════ NEWS FILTER ════════                                    |
//+------------------------------------------------------------------+
input bool   InpUseNewsFilter      = true;    // Enable economic calendar news filter
input int    InpNewsMinBefore      = 30;      // Minutes to block before news
input int    InpNewsMinAfter       = 30;      // Minutes to block after news
input bool   InpFilterHighImpact   = true;    // Block HIGH impact events
input bool   InpFilterMedImpact    = false;   // Block MEDIUM impact events

//+------------------------------------------------------------------+
//| ════════ PID MASTER ════════                                     |
//+------------------------------------------------------------------+
input bool   InpPIDEnabled         = true;    // Enable PID adaptive risk control
input double InpPIDMinRisk         = 0.10;    // PID minimum risk floor (% balance)
input double InpPIDMaxRisk         = 5.00;    // PID maximum risk ceiling (% balance)
input double InpPIDDeadband        = 0.05;    // Deadband — ignore errors smaller than this
input double InpPIDDerivFilter     = 0.50;    // Derivative low-pass filter (0=off, 1=full)
input double InpPIDMaxStep         = 0.50;    // Max risk change per bar (slew rate limit)

//+------------------------------------------------------------------+
//| ════════ EQUITY PID (EPID) ════════                              |
//+------------------------------------------------------------------+
input double InpEPIDKp             = 2.0;     // EPID proportional gain
input double InpEPIDKi             = 0.1;     // EPID integral gain
input double InpEPIDKd             = 0.5;     // EPID derivative gain
input double InpEPIDTarget         = 0.60;    // EPID daily profit target (% balance)

//+------------------------------------------------------------------+
//| ════════ VOLATILITY PID (VPID) ════════                         |
//+------------------------------------------------------------------+
input bool   InpVPIDEnabled        = true;    // Enable volatility regime PID
input double InpVPIDKp             = 1.5;     // VPID proportional gain
input double InpVPIDKi             = 0.05;    // VPID integral gain
input int    InpVPIDATRMA          = 20;      // VPID ATR moving average period

//+------------------------------------------------------------------+
//| ════════ WIN-RATE PID (WRPID) ════════                          |
//+------------------------------------------------------------------+
input bool   InpWRPIDEnabled       = true;    // Enable win-rate PID
input double InpWRPIDKp            = 1.0;     // WRPID proportional gain
input double InpWRPIDKi            = 0.2;     // WRPID integral gain
input int    InpWRPIDWindow        = 20;      // WRPID rolling trade window
input double InpWRPIDTarget        = 0.50;    // WRPID target win rate

//+------------------------------------------------------------------+
//| ════════ DRAWDOWN-VELOCITY PID (DVPID) ════════                 |
//+------------------------------------------------------------------+
input bool   InpDVPIDEnabled       = true;    // Enable drawdown velocity PID
input double InpDVPIDKp            = 3.0;     // DVPID proportional gain (aggressive)
input double InpDVPIDKd            = 1.0;     // DVPID derivative gain
input int    InpDVPIDWindow        = 5;       // DVPID equity velocity window (bars)

//+------------------------------------------------------------------+
//| ════════ SPREAD PID (SPID) ════════                             |
//+------------------------------------------------------------------+
input bool   InpSPIDEnabled        = true;    // Enable spread regime PID
input double InpSPIDKp             = 2.0;     // SPID proportional gain
input int    InpSPIDWindow         = 50;      // SPID rolling spread window (samples)

//+------------------------------------------------------------------+
//| ════════ DISPLAY SETTINGS ════════                               |
//+------------------------------------------------------------------+
input bool   InpShowDashboard      = true;    // Show on-chart dashboard
input uint   InpDashIntervalMs     = 250;     // Dashboard refresh interval (ms)
input color  InpDashBG             = clrMidnightBlue;  // Dashboard background color
input color  InpDashText           = clrWhite;          // Dashboard text color
input bool   InpLogTrades          = true;    // Log closed trades to CSV (Files folder)

//+------------------------------------------------------------------+
//| Core Logic — all event handlers defined in ProTrader_Core.mqh   |
//+------------------------------------------------------------------+
#include "ProTrader_Core.mqh"
//+------------------------------------------------------------------+
