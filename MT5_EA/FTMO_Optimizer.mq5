//+------------------------------------------------------------------+
//|                    FTMO_Optimizer.mq5                            |
//|   Walk-Forward Optimization helper script for FTMO ProTrader    |
//|                                                                  |
//|  PURPOSE: Runs a Monte Carlo equity-curve stress test           |
//|  on a CSV export of the backtest trade history to validate      |
//|  robustness before running the EA on a live FTMO challenge.     |
//+------------------------------------------------------------------+
#property script_show_inputs
#property copyright "FTMO ProTrader EA"

input string  InpTradeHistoryCSV = "FTMO_trades.csv";  // Trade history CSV file
input int     InpMonteCarloRuns  = 1000;                // Monte Carlo simulations
input double  InpStartBalance    = 100000.0;            // Starting account balance
input double  InpMaxDailyLossPC  = 4.5;                 // FTMO daily loss limit %
input double  InpMaxTotalDDPC    = 9.0;                 // FTMO max drawdown %
input double  InpProfitTargetPC  = 10.0;                // FTMO profit target %

void OnStart()
{
    //--- Load trade results from CSV
    double trades[];
    int loaded = LoadTradesFromCSV(InpTradeHistoryCSV, trades);

    if(loaded <= 0)
    {
        Print("No trades loaded. Create CSV with one P&L value per line (in $).");
        Print("Example format: 150.25");
        Print("               -75.00");
        Print("               220.50");
        return;
    }

    Print("Loaded ", loaded, " trades for Monte Carlo analysis.");

    //--- Run Monte Carlo
    int    passCount   = 0;
    int    failDaily   = 0;
    int    failTotal   = 0;
    int    hitTarget   = 0;
    double maxProfit   = -DBL_MAX;
    double minEndEquity= DBL_MAX;
    double avgEndEquity= 0;

    double maxDD_limit  = InpStartBalance * InpMaxTotalDDPC  / 100.0;
    double dailyDD_limit= InpStartBalance * InpMaxDailyLossPC/ 100.0;
    double profitTarget = InpStartBalance * InpProfitTargetPC / 100.0;

    MathSrand((int)TimeLocal());

    for(int sim = 0; sim < InpMonteCarloRuns; sim++)
    {
        double equity      = InpStartBalance;
        double maxEquity   = InpStartBalance;
        bool   failedD     = false;
        bool   failedT     = false;
        bool   reachedTP   = false;

        //--- Daily tracking (approximate: group every 5 trades = 1 week)
        double dayStart    = InpStartBalance;
        int    tradeCount  = 0;

        //--- Shuffle and replay trades
        double shuffled[];
        ArrayCopy(shuffled, trades);
        ShuffleArray(shuffled);

        for(int t = 0; t < ArraySize(shuffled); t++)
        {
            equity += shuffled[t];

            //--- Daily loss check (every 5 trades simulate a day)
            tradeCount++;
            if(tradeCount % 5 == 0)
            {
                if((dayStart - equity) >= dailyDD_limit)
                { failedD = true; break; }
                dayStart = equity;
            }

            //--- Max drawdown from peak
            if(equity > maxEquity) maxEquity = equity;
            double dd = maxEquity - equity;
            if(dd >= maxDD_limit)
            { failedT = true; break; }

            //--- Profit target
            if(equity >= InpStartBalance + profitTarget)
            { reachedTP = true; break; }
        }

        if(!failedD && !failedT) passCount++;
        if(failedD) failDaily++;
        if(failedT) failTotal++;
        if(reachedTP) hitTarget++;

        maxProfit    = MathMax(maxProfit, equity - InpStartBalance);
        minEndEquity = MathMin(minEndEquity, equity);
        avgEndEquity += equity;
    }

    avgEndEquity /= InpMonteCarloRuns;

    //--- Print results
    Print("════════════════════════════════════════");
    Print("   FTMO Monte Carlo Stress Test Results");
    Print("════════════════════════════════════════");
    Print("Simulations Run    : ", InpMonteCarloRuns);
    Print("Trades per Sim     : ", loaded);
    Print("────────────────────────────────────────");
    Print("FTMO PASS Rate     : ", DoubleToString((double)passCount/InpMonteCarloRuns*100, 1), "%");
    Print("Failed Daily Loss  : ", DoubleToString((double)failDaily/InpMonteCarloRuns*100, 1), "%");
    Print("Failed Max DD      : ", DoubleToString((double)failTotal/InpMonteCarloRuns*100, 1), "%");
    Print("Hit Profit Target  : ", DoubleToString((double)hitTarget/InpMonteCarloRuns*100, 1), "%");
    Print("────────────────────────────────────────");
    Print("Avg End Equity     : $", DoubleToString(avgEndEquity, 2));
    Print("Min End Equity     : $", DoubleToString(minEndEquity, 2));
    Print("Max Profit         : $", DoubleToString(maxProfit, 2));
    Print("════════════════════════════════════════");

    if((double)passCount/InpMonteCarloRuns >= 0.70)
        Print("VERDICT: Strategy is ROBUST for FTMO (>=70% pass rate)");
    else if((double)passCount/InpMonteCarloRuns >= 0.50)
        Print("VERDICT: Strategy is MARGINAL - adjust risk settings");
    else
        Print("VERDICT: Strategy is NOT READY for FTMO - reduce risk or refine signals");
}

int LoadTradesFromCSV(string filename, double &out[])
{
    int handle = FileOpen(filename, FILE_READ|FILE_CSV|FILE_ANSI, ',');
    if(handle == INVALID_HANDLE)
    {
        Print("Cannot open file: ", filename, " Error: ", GetLastError());
        return 0;
    }

    int count = 0;
    while(!FileIsEnding(handle))
    {
        string line = FileReadString(handle);
        if(StringLen(line) == 0) continue;
        double val = StringToDouble(line);
        ArrayResize(out, count + 1);
        out[count++] = val;
    }

    FileClose(handle);
    return count;
}

void ShuffleArray(double &arr[])
{
    int n = ArraySize(arr);
    for(int i = n - 1; i > 0; i--)
    {
        int j = MathRand() % (i + 1);
        double tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}
