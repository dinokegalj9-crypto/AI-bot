#!/usr/bin/env python3
"""
validate.py — Static validation for the ProTrader MT5 EA project.

Run from the MT5_EA/ directory:
    python3 validate.py

Exit code 0 = all checks passed.
Exit code 1 = one or more checks failed.
"""

import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------

_results: list[tuple[bool, str, str]] = []   # (passed, category, detail)
_warnings: list[str] = []


def _record(passed: bool, category: str, description: str, detail: str = "") -> bool:
    tag = "[PASS]" if passed else "[FAIL]"
    if detail:
        print(f"{tag} {category}: {description} — {detail}")
    else:
        print(f"{tag} {category}: {description}")
    _results.append((passed, category, description))
    return passed


def warn(msg: str) -> None:
    print(f"[WARN] {msg}")
    _warnings.append(msg)


def check(passed: bool, category: str, description: str, detail: str = "") -> bool:
    return _record(passed, category, description, detail)


# ---------------------------------------------------------------------------
# Helper: read file text (returns None if not found)
# ---------------------------------------------------------------------------

def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return None


# ---------------------------------------------------------------------------
# Helper: strip comments and string literals for bracket counting
# ---------------------------------------------------------------------------

def strip_for_bracket_count(source: str) -> str:
    """
    Return source with:
      1. String literals (double-quoted, handling \" escapes) replaced by ""
      2. Single-line comments (// …) removed (line truncated at //)
      3. Block comments (/* … */) removed

    Done with a single-pass state machine for correctness.
    """
    result: list[str] = []
    i = 0
    n = len(source)

    while i < n:
        c = source[i]

        # --- Block comment ---
        if c == '/' and i + 1 < n and source[i + 1] == '*':
            i += 2
            while i < n:
                if source[i] == '*' and i + 1 < n and source[i + 1] == '/':
                    i += 2
                    break
                i += 1
            continue

        # --- Line comment ---
        if c == '/' and i + 1 < n and source[i + 1] == '/':
            # Skip until end of line (keep the newline itself)
            while i < n and source[i] != '\n':
                i += 1
            continue

        # --- String literal ---
        if c == '"':
            result.append('"')
            i += 1
            while i < n:
                ch = source[i]
                if ch == '\\':
                    i += 2          # skip escaped character
                    continue
                if ch == '"':
                    result.append('"')
                    i += 1
                    break
                i += 1
            continue

        result.append(c)
        i += 1

    return "".join(result)


# ---------------------------------------------------------------------------
# Helper: extract input defaults
# ---------------------------------------------------------------------------

def extract_inputs(text: str) -> dict[str, str]:
    """
    Return dict mapping input-name → default-value string.
    Matches lines like:
        input bool InpFTMOMode = true;
        input double InpMaxDailyLoss = 4.5;  // comment
    """
    pattern = re.compile(r'\binput\s+\S+\s+(Inp\w+)\s*=\s*([\w.]+)', re.MULTILINE)
    return {m.group(1): m.group(2) for m in pattern.finditer(text)}


def extract_input_names(text: str) -> set[str]:
    pattern = re.compile(r'\binput\s+\S+\s+(Inp\w+)', re.MULTILINE)
    return {m.group(1) for m in pattern.finditer(text)}


# ---------------------------------------------------------------------------
# Category 1 — File existence
# ---------------------------------------------------------------------------

REQUIRED_FILES = [
    "FTMO_ProTrader_EA.mq5",
    "MAX_ProTrader_EA.mq5",
    "ProTrader_Core.mqh",
    "ProTrader_PIDs.mqh",
    "FTMO_UnitTests.mq5",
]
FTMO_SET  = "FTMO_BacktestConfig.set"
MAX_SET   = "MAX_BacktestConfig.set"


def check_file_existence(base: Path) -> None:
    for fname in REQUIRED_FILES:
        p = base / fname
        check(p.exists(), "File Existence", f"{fname} exists",
              "" if p.exists() else f"not found at {p}")

    p_ftmo = base / FTMO_SET
    check(p_ftmo.exists(), "File Existence", f"{FTMO_SET} exists",
          "" if p_ftmo.exists() else f"not found at {p_ftmo}")

    p_max = base / MAX_SET
    if not p_max.exists():
        warn(f"{MAX_SET} not found — MAX config checks will be skipped")


# ---------------------------------------------------------------------------
# Category 2 — Include guard correctness
# ---------------------------------------------------------------------------

def check_include_guards(base: Path) -> None:
    guards = {
        "ProTrader_Core.mqh": ("PROTRADER_CORE_MQH",),
        "ProTrader_PIDs.mqh": ("PROTRADER_PIDS_MQH",),
    }
    for fname, (symbol,) in guards.items():
        text = read_text(base / fname)
        if text is None:
            check(False, "Include Guards", f"{fname} has #ifndef {symbol}",
                  "file not found")
            check(False, "Include Guards", f"{fname} has #define {symbol}",
                  "file not found")
            check(False, "Include Guards", f"{fname} has closing #endif",
                  "file not found")
            continue

        has_ifndef = bool(re.search(rf'#ifndef\s+{re.escape(symbol)}', text))
        has_define = bool(re.search(rf'#define\s+{re.escape(symbol)}', text))
        has_endif  = bool(re.search(r'#endif', text))

        check(has_ifndef, "Include Guards",
              f"{fname} has #ifndef {symbol}")
        check(has_define, "Include Guards",
              f"{fname} has #define {symbol}")
        check(has_endif,  "Include Guards",
              f"{fname} has closing #endif")


# ---------------------------------------------------------------------------
# Category 3 — Include ordering
# ---------------------------------------------------------------------------

def _include_positions(text: str) -> dict[str, int]:
    """Return {header_fragment: first_line_number} for each #include found."""
    positions: dict[str, int] = {}
    for i, line in enumerate(text.splitlines(), 1):
        m = re.search(r'#include\s*[<"]([^>"]+)[>"]', line)
        if m:
            fragment = m.group(1)
            if fragment not in positions:
                positions[fragment] = i
    return positions


def _line_of_last_include(text: str) -> int:
    last = 0
    for i, line in enumerate(text.splitlines(), 1):
        if re.search(r'#include\s*[<"]([^>"]+)[>"]', line):
            last = i
    return last


def check_include_ordering(base: Path) -> None:
    wrappers = {
        "FTMO_ProTrader_EA.mq5": "FTMO",
        "MAX_ProTrader_EA.mq5":  "MAX",
    }
    for fname, label in wrappers.items():
        text = read_text(base / fname)
        if text is None:
            for desc in [
                f"{label} wrapper: Trade\\Trade.mqh before ProTrader_Core.mqh",
                f"{label} wrapper: Trade\\PositionInfo.mqh before ProTrader_Core.mqh",
                f"{label} wrapper: ProTrader_Core.mqh is last include",
            ]:
                check(False, "Include Ordering", desc, "file not found")
            continue

        positions = _include_positions(text)

        # Normalise keys: strip path separators for matching
        def pos(fragment: str) -> int:
            for key, v in positions.items():
                if fragment.lower() in key.lower().replace("\\", "/"):
                    return v
            return -1

        trade_pos  = pos("trade/trade.mqh")
        posinfo_pos = pos("trade/positioninfo.mqh")
        core_pos   = pos("protrader_core.mqh")

        if core_pos == -1:
            check(False, "Include Ordering",
                  f"{label} wrapper: Trade\\Trade.mqh before ProTrader_Core.mqh",
                  "ProTrader_Core.mqh include not found")
            check(False, "Include Ordering",
                  f"{label} wrapper: Trade\\PositionInfo.mqh before ProTrader_Core.mqh",
                  "ProTrader_Core.mqh include not found")
        else:
            check(
                trade_pos != -1 and trade_pos < core_pos,
                "Include Ordering",
                f"{label} wrapper: Trade\\Trade.mqh before ProTrader_Core.mqh",
                f"Trade.mqh line={trade_pos}, Core line={core_pos}"
                if not (trade_pos != -1 and trade_pos < core_pos) else "",
            )
            check(
                posinfo_pos != -1 and posinfo_pos < core_pos,
                "Include Ordering",
                f"{label} wrapper: Trade\\PositionInfo.mqh before ProTrader_Core.mqh",
                f"PositionInfo.mqh line={posinfo_pos}, Core line={core_pos}"
                if not (posinfo_pos != -1 and posinfo_pos < core_pos) else "",
            )

        last_include_line = _line_of_last_include(text)
        check(
            core_pos != -1 and core_pos == last_include_line,
            "Include Ordering",
            f"{label} wrapper: ProTrader_Core.mqh is the last include",
            f"Core at line {core_pos}, last include at line {last_include_line}"
            if not (core_pos != -1 and core_pos == last_include_line) else "",
        )

    # Core: ProTrader_PIDs.mqh appears in the file
    core_text = read_text(base / "ProTrader_Core.mqh")
    if core_text is None:
        check(False, "Include Ordering",
              "ProTrader_Core.mqh includes ProTrader_PIDs.mqh", "file not found")
    else:
        has_pids = bool(re.search(r'#include\s*[<"].*ProTrader_PIDs\.mqh[>"]',
                                   core_text, re.IGNORECASE))
        check(has_pids, "Include Ordering",
              "ProTrader_Core.mqh includes ProTrader_PIDs.mqh")


# ---------------------------------------------------------------------------
# Category 4 — Input parity
# ---------------------------------------------------------------------------

def check_input_parity(base: Path) -> None:
    ftmo_text = read_text(base / "FTMO_ProTrader_EA.mq5")
    max_text  = read_text(base / "MAX_ProTrader_EA.mq5")
    if ftmo_text is None or max_text is None:
        check(False, "Input Parity", "FTMO and MAX wrappers have identical input sets",
              "one or both files missing")
        return

    ftmo_names = extract_input_names(ftmo_text)
    max_names  = extract_input_names(max_text)

    only_ftmo  = ftmo_names - max_names
    only_max   = max_names  - ftmo_names

    if not only_ftmo and not only_max:
        check(True, "Input Parity",
              "FTMO and MAX wrappers have identical input sets")
    else:
        detail_parts = []
        if only_ftmo:
            detail_parts.append(f"FTMO-only: {sorted(only_ftmo)}")
        if only_max:
            detail_parts.append(f"MAX-only: {sorted(only_max)}")
        check(False, "Input Parity",
              "FTMO and MAX wrappers have identical input sets",
              "; ".join(detail_parts))


# ---------------------------------------------------------------------------
# Category 5 — Required input names present
# ---------------------------------------------------------------------------

REQUIRED_INPUTS = [
    "InpFTMOMode",
    "InpEnforceDailyLimit",
    "InpEnforceTotalLimit",
    "InpEnforceProfitStop",
    "InpPIDEnabled",
    "InpPIDMinRisk",
    "InpPIDMaxRisk",
    "InpEPIDKp",
    "InpVPIDEnabled",
    "InpWRPIDEnabled",
    "InpDVPIDEnabled",
    "InpSPIDEnabled",
]


def check_required_inputs(base: Path) -> None:
    ftmo_text = read_text(base / "FTMO_ProTrader_EA.mq5")
    max_text  = read_text(base / "MAX_ProTrader_EA.mq5")

    for inp in REQUIRED_INPUTS:
        for label, text in (("FTMO", ftmo_text), ("MAX", max_text)):
            if text is None:
                check(False, "Required Inputs",
                      f"{inp} present in {label} wrapper", "file not found")
                continue
            names = extract_input_names(text)
            check(inp in names, "Required Inputs",
                  f"{inp} present in {label} wrapper")


# ---------------------------------------------------------------------------
# Category 6 — Default value checks
# ---------------------------------------------------------------------------

def _to_float(val: str) -> float | None:
    try:
        if val.lower() in ("true",  "1"): return 1.0
        if val.lower() in ("false", "0"): return 0.0
        return float(val)
    except ValueError:
        return None


def check_defaults(base: Path) -> None:
    ftmo_text = read_text(base / "FTMO_ProTrader_EA.mq5")
    max_text  = read_text(base / "MAX_ProTrader_EA.mq5")

    def get(defaults: dict[str, str], name: str) -> float | None:
        v = defaults.get(name)
        return _to_float(v) if v is not None else None

    # --- FTMO wrapper ---
    if ftmo_text is None:
        for desc in [
            "FTMO: InpFTMOMode = true",
            "FTMO: InpEnforceDailyLimit = true",
            "FTMO: InpMaxDailyLoss < 5.0",
            "FTMO: InpMaxTotalLoss < 10.0",
            "FTMO: InpPIDMaxRisk <= 2.0",
            "FTMO: InpMagicNumber = 202401",
        ]:
            check(False, "Default Values", desc, "file not found")
    else:
        fd = extract_inputs(ftmo_text)

        v = get(fd, "InpFTMOMode")
        check(v == 1.0, "Default Values", "FTMO: InpFTMOMode = true",
              f"got {fd.get('InpFTMOMode')}" if v != 1.0 else "")

        v = get(fd, "InpEnforceDailyLimit")
        check(v == 1.0, "Default Values", "FTMO: InpEnforceDailyLimit = true",
              f"got {fd.get('InpEnforceDailyLimit')}" if v != 1.0 else "")

        v = get(fd, "InpMaxDailyLoss")
        check(v is not None and v < 5.0, "Default Values",
              "FTMO: InpMaxDailyLoss < 5.0",
              f"got {fd.get('InpMaxDailyLoss')}" if not (v is not None and v < 5.0) else "")

        v = get(fd, "InpMaxTotalLoss")
        check(v is not None and v < 10.0, "Default Values",
              "FTMO: InpMaxTotalLoss < 10.0",
              f"got {fd.get('InpMaxTotalLoss')}" if not (v is not None and v < 10.0) else "")

        v = get(fd, "InpPIDMaxRisk")
        check(v is not None and v <= 2.0, "Default Values",
              "FTMO: InpPIDMaxRisk <= 2.0",
              f"got {fd.get('InpPIDMaxRisk')}" if not (v is not None and v <= 2.0) else "")

        v = get(fd, "InpMagicNumber")
        check(v == 202401.0, "Default Values", "FTMO: InpMagicNumber = 202401",
              f"got {fd.get('InpMagicNumber')}" if v != 202401.0 else "")

    # --- MAX wrapper ---
    if max_text is None:
        for desc in [
            "MAX: InpFTMOMode = false",
            "MAX: InpEnforceDailyLimit = false",
            "MAX: InpMagicNumber = 202402",
            "MAX: InpPIDMaxRisk > 2.0",
        ]:
            check(False, "Default Values", desc, "file not found")
    else:
        md = extract_inputs(max_text)

        v = get(md, "InpFTMOMode")
        check(v == 0.0, "Default Values", "MAX: InpFTMOMode = false",
              f"got {md.get('InpFTMOMode')}" if v != 0.0 else "")

        v = get(md, "InpEnforceDailyLimit")
        check(v == 0.0, "Default Values", "MAX: InpEnforceDailyLimit = false",
              f"got {md.get('InpEnforceDailyLimit')}" if v != 0.0 else "")

        v = get(md, "InpMagicNumber")
        check(v == 202402.0, "Default Values", "MAX: InpMagicNumber = 202402",
              f"got {md.get('InpMagicNumber')}" if v != 202402.0 else "")

        v = get(md, "InpPIDMaxRisk")
        check(v is not None and v > 2.0, "Default Values",
              "MAX: InpPIDMaxRisk > 2.0",
              f"got {md.get('InpPIDMaxRisk')}" if not (v is not None and v > 2.0) else "")


# ---------------------------------------------------------------------------
# Category 7 — FTMO mode exclusivity
# ---------------------------------------------------------------------------

def check_ftmo_exclusivity(base: Path) -> None:
    ftmo_text = read_text(base / "FTMO_ProTrader_EA.mq5")
    max_text  = read_text(base / "MAX_ProTrader_EA.mq5")

    if ftmo_text is None or max_text is None:
        check(False, "FTMO Exclusivity",
              "FTMO magic (202401) != MAX magic (202402) — no GlobalVar collision",
              "one or both files missing")
        return

    ftmo_defaults = extract_inputs(ftmo_text)
    max_defaults  = extract_inputs(max_text)

    ftmo_magic = _to_float(ftmo_defaults.get("InpMagicNumber", "0"))
    max_magic  = _to_float(max_defaults.get("InpMagicNumber", "0"))

    check(
        ftmo_magic is not None and max_magic is not None
        and ftmo_magic != max_magic,
        "FTMO Exclusivity",
        "FTMO magic (202401) != MAX magic (202402) — no GlobalVar collision",
        f"FTMO={ftmo_magic}, MAX={max_magic}"
        if not (ftmo_magic is not None and max_magic is not None
                and ftmo_magic != max_magic) else "",
    )

    check(
        ftmo_magic == 202401.0,
        "FTMO Exclusivity",
        "FTMO magic number is exactly 202401",
        f"got {ftmo_magic}" if ftmo_magic != 202401.0 else "",
    )


# ---------------------------------------------------------------------------
# Category 8 — PID symbol checks
# ---------------------------------------------------------------------------

def _contains(text: str, symbol: str) -> bool:
    return symbol in text


def check_pid_symbols(base: Path) -> None:
    pids_text = read_text(base / "ProTrader_PIDs.mqh")
    core_text = read_text(base / "ProTrader_Core.mqh")

    pid_symbols = [
        ("EPID_Update",          "Contains EPID_Update function"),
        ("VPID_Update",          "Contains VPID_Update function"),
        ("WRPID_Update",         "Contains WRPID_Update or WRPID_AddOutcome"),
        ("DVPID_Update",         "Contains DVPID_Update function"),
        ("SPID_Update",          "Contains SPID_Update function"),
        ("PID_GetEffectiveRisk", "Contains PID_GetEffectiveRisk function"),
        ("PID_InitAll",          "Contains PID_InitAll function"),
        ("PID_NotifyTrade",      "Contains PID_NotifyTrade or WRPID_AddOutcome function"),
    ]

    for symbol, desc in pid_symbols:
        if pids_text is None:
            check(False, "PID Symbols", f"ProTrader_PIDs.mqh: {desc}",
                  "file not found")
            continue
        # Special-case compound checks
        if symbol == "WRPID_Update":
            found = _contains(pids_text, "WRPID_Update") or \
                    (_contains(pids_text, "WRPID_AddOutcome") and
                     _contains(pids_text, "WRPID_Mult"))
            # Also accept plain WRPID_Update
            found = _contains(pids_text, "WRPID_Update") or \
                    _contains(pids_text, "WRPID_AddOutcome")
        elif symbol == "PID_NotifyTrade":
            found = _contains(pids_text, "PID_NotifyTrade") or \
                    _contains(pids_text, "WRPID_AddOutcome")
        else:
            found = _contains(pids_text, symbol)
        check(found, "PID Symbols", f"ProTrader_PIDs.mqh: {desc}")

    core_pid_calls = [
        ("PID_InitAll",          "Core calls PID_InitAll"),
        ("PID_GetEffectiveRisk", "Core calls PID_GetEffectiveRisk"),
        ("PID_DailyReset",       "Core calls PID_DailyReset"),
        ("PID_NotifyTrade",      "Core calls PID_NotifyTrade"),
    ]
    for symbol, desc in core_pid_calls:
        if core_text is None:
            check(False, "PID Symbols", f"ProTrader_Core.mqh: {desc}",
                  "file not found")
            continue
        check(_contains(core_text, symbol), "PID Symbols",
              f"ProTrader_Core.mqh: {desc}")


# ---------------------------------------------------------------------------
# Category 9 — Core function presence
# ---------------------------------------------------------------------------

CORE_FUNCTIONS = [
    "OnInit",
    "OnDeinit",
    "OnTick",
    "Core_TickBody",
    "OnTradeTransaction",
    "ValidateInputs",
    "UpdateRiskManagement",
    "CalcLotSize",
    "GetSignal",
    "ManageOpenTrades",
    "IsInTradingSession",
    "IsNewsTime",
]


def check_core_functions(base: Path) -> None:
    core_text = read_text(base / "ProTrader_Core.mqh")
    for func in CORE_FUNCTIONS:
        if core_text is None:
            check(False, "Core Functions",
                  f"ProTrader_Core.mqh contains {func}", "file not found")
            continue
        check(_contains(core_text, func), "Core Functions",
              f"ProTrader_Core.mqh contains {func}")


# ---------------------------------------------------------------------------
# Category 10 — Safety features
# ---------------------------------------------------------------------------

def check_safety_features(base: Path) -> None:
    core_text = read_text(base / "ProTrader_Core.mqh")

    safety_checks = [
        ("INIT_PARAMETERS_INCORRECT", "Contains INIT_PARAMETERS_INCORRECT (validation gate)"),
        ("CloseAllTrades",             "Contains CloseAllTrades (halt enforcement)"),
        ("GlobalVariableSet",          "Contains GlobalVariableSet (state persistence)"),
        ("GlobalVariableGet",          "Contains GlobalVariableGet (state restore)"),
        ("g_gv",                       "Contains g_gv (magic-keyed GlobalVar prefix)"),
        (None,                         "Contains reentrancy guard s_inTick or g_inTick"),
        ("SPID_MaxSpread",             "Contains SPID_MaxSpread call (dynamic spread threshold)"),
        ("PID_DailyReset",             "Contains PID_DailyReset call"),
    ]

    for symbol, desc in safety_checks:
        if core_text is None:
            check(False, "Safety Features",
                  f"ProTrader_Core.mqh: {desc}", "file not found")
            continue
        if symbol is None:
            # Reentrancy guard: accept s_inTick or g_inTick
            found = _contains(core_text, "s_inTick") or _contains(core_text, "g_inTick")
        else:
            found = _contains(core_text, symbol)
        check(found, "Safety Features", f"ProTrader_Core.mqh: {desc}")


# ---------------------------------------------------------------------------
# Category 11 — Bracket balance
# ---------------------------------------------------------------------------

def check_bracket_balance(base: Path) -> None:
    files = [
        "FTMO_ProTrader_EA.mq5",
        "MAX_ProTrader_EA.mq5",
        "ProTrader_Core.mqh",
        "ProTrader_PIDs.mqh",
    ]
    for fname in files:
        text = read_text(base / fname)
        if text is None:
            check(False, "Bracket Balance", f"{fname} has balanced braces",
                  "file not found")
            continue
        stripped = strip_for_bracket_count(text)
        opens  = stripped.count('{')
        closes = stripped.count('}')
        ok = opens == closes
        check(ok, "Bracket Balance", f"{fname} has balanced braces",
              f"{{ count={opens}, }} count={closes}"
              if not ok else "")


# ---------------------------------------------------------------------------
# Category 12 — PID behavioral simulation
# ---------------------------------------------------------------------------

def _pid_clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def check_pid_simulation(base: Path) -> None:
    ftmo_text = read_text(base / "FTMO_ProTrader_EA.mq5")

    if ftmo_text is None:
        for desc in [
            "EPID sign: drawdown (error<0) reduces risk",
            "EPID sign: profit (error>0) increases risk",
            "VPID sign: high ATR ratio reduces multiplier",
            "VPID sign: low ATR ratio increases multiplier",
            "WRPID sign: low win-rate reduces multiplier",
            "WRPID sign: high win-rate increases multiplier",
            "DVPID asymmetry: negative velocity reduces multiplier",
            "DVPID asymmetry: positive velocity never exceeds 1.0",
            "SPID sign: high spread reduces multiplier",
            "SPID sign: low spread increases multiplier",
            "Combined bounds: all-min output >= InpPIDMinRisk",
            "Combined bounds: all-max output <= InpPIDMaxRisk",
        ]:
            check(False, "PID Simulation", desc, "FTMO file not found")
        return

    fd = extract_inputs(ftmo_text)

    def fget(name: str, fallback: float) -> float:
        v = _to_float(fd.get(name, str(fallback)))
        return v if v is not None else fallback

    epid_kp   = fget("InpEPIDKp",   2.0)
    pid_min   = fget("InpPIDMinRisk", 0.10)
    pid_max   = fget("InpPIDMaxRisk", 2.00)
    pid_step  = fget("InpPIDMaxStep", 0.25)
    pid_db    = fget("InpPIDDeadband", 0.05)
    epid_ki   = fget("InpEPIDKi",   0.1)
    epid_kd   = fget("InpEPIDKd",   0.5)

    # ---- EPID sign test ----
    # The EPID outputs an absolute risk % value.
    # pidOut = Kp*error + Ki*integral + Kd*deriv  is the PID's TARGET absolute risk.
    # The slew-rate limit moves s_epid_output toward pidOut at most pid_step per bar.
    #
    # Sign invariant to verify:
    #   positive error (equity above target) → higher pidOut → converges to higher risk
    #   negative error (equity below target) → lower pidOut  → converges to lower risk
    #
    # We test this by running N steps with a LARGE constant error from a zero-seed
    # (s_epid_output = 0) so the slew steps add up and the direction is clear.
    # We compare: run(large positive error) vs run(large negative error).
    N_STEPS = 20

    def epid_run(error_const: float, n: int, seed: float = 0.0) -> float:
        """Run EPID n steps with constant error from seed; return final clamped output."""
        if abs(error_const) < pid_db:
            error_const = 0.0
        output   = seed
        integral = 0.0
        prev_err = 0.0
        prev_d   = 0.0
        alpha    = _pid_clamp(fget("InpPIDDerivFilter", 0.5), 0.0, 1.0)
        for _ in range(n):
            raw_d  = error_const - prev_err
            filt_d = alpha * raw_d + (1.0 - alpha) * prev_d
            prev_integral = integral
            integral += error_const
            # Incremental mode: PID output is a DELTA, not an absolute target
            delta     = epid_kp * error_const + epid_ki * integral + epid_kd * filt_d
            step      = _pid_clamp(delta, -pid_step, pid_step)
            candidate = output + step
            clamped   = _pid_clamp(candidate, pid_min, pid_max)
            if clamped != candidate:
                integral = prev_integral
            output   = clamped
            prev_err = error_const
            prev_d   = filt_d
        return output

    # Run from zero-seed: positive error should produce strictly MORE risk
    # than negative error over the same number of steps.
    out_neg = epid_run(-0.20, N_STEPS, seed=0.0)
    out_pos = epid_run(+0.20, N_STEPS, seed=0.0)

    # Drawdown: large negative error converges toward lower absolute risk than positive error
    check(out_neg < out_pos, "PID Simulation",
          "EPID sign: drawdown (error<0) reduces risk",
          f"neg_error_out={out_neg:.4f}, pos_error_out={out_pos:.4f}")

    # Profit: large positive error drives to higher risk than negative error
    check(out_pos > out_neg, "PID Simulation",
          "EPID sign: profit (error>0) increases risk",
          f"pos_error_out={out_pos:.4f}, neg_error_out={out_neg:.4f}")

    # ---- VPID sign test ----
    # error = 1.0 - measurement; positive error → multiplier increases
    vpid_kp = fget("InpVPIDKp", 1.5)
    vpid_db = pid_db * 0.5

    def vpid_one_step(atr_ratio: float, current_mult: float) -> float:
        error = 1.0 - atr_ratio
        if abs(error) < vpid_db:
            error = 0.0
        pid_out = vpid_kp * error
        delta   = _pid_clamp(pid_out - (current_mult - 1.0), -0.05, 0.05)
        candidate = current_mult + delta
        return _pid_clamp(candidate, 0.3, 1.5)

    # High ATR (ratio=2.0) → error = 1.0-2.0 = -1.0 → mult decreases
    out_high_atr = vpid_one_step(2.0, 1.0)
    check(out_high_atr < 1.0, "PID Simulation",
          "VPID sign: high ATR ratio reduces multiplier",
          f"mult={out_high_atr:.4f}")

    # Low ATR (ratio=0.5) → error = 1.0-0.5 = +0.5 → mult increases
    out_low_atr = vpid_one_step(0.5, 1.0)
    check(out_low_atr > 1.0, "PID Simulation",
          "VPID sign: low ATR ratio increases multiplier",
          f"mult={out_low_atr:.4f}")

    # ---- WRPID sign test ----
    wrpid_kp     = fget("InpWRPIDKp", 1.0)
    wrpid_target = fget("InpWRPIDTarget", 0.50)   # stored as fraction (0.50 means 50%)
    # Target may be stored as 0.50 (fraction) or 50.0 (percent) — normalise
    if wrpid_target > 1.0:
        wrpid_target /= 100.0

    def wrpid_one_step(win_rate: float, current_mult: float) -> float:
        error = win_rate - wrpid_target
        pid_out = wrpid_kp * error
        delta   = _pid_clamp(pid_out - (current_mult - 1.0), -0.05, 0.05)
        candidate = current_mult + delta
        return _pid_clamp(candidate, 0.3, 1.5)

    out_low_wr = wrpid_one_step(0.3, 1.0)
    check(out_low_wr < 1.0, "PID Simulation",
          "WRPID sign: low win-rate reduces multiplier",
          f"win_rate=0.3, mult={out_low_wr:.4f}")

    out_high_wr = wrpid_one_step(0.7, 1.0)
    check(out_high_wr > 1.0, "PID Simulation",
          "WRPID sign: high win-rate increases multiplier",
          f"win_rate=0.7, mult={out_high_wr:.4f}")

    # ---- DVPID asymmetry test ----
    dvpid_kp = fget("InpDVPIDKp", 3.0)

    def dvpid_one_step(velocity: float, current_mult: float) -> float:
        if velocity < 0.0:
            correction = dvpid_kp * abs(velocity)
            step = _pid_clamp(-correction, -0.05, 0.0)
        else:
            correction = 0.5 * velocity
            step = _pid_clamp(correction, 0.0, 0.01)
        candidate = current_mult + step
        return _pid_clamp(candidate, 0.1, 1.0)

    # Negative velocity → mult < 1.0
    out_neg_vel = dvpid_one_step(-0.01, 1.0)
    check(out_neg_vel < 1.0, "PID Simulation",
          "DVPID asymmetry: negative velocity reduces multiplier",
          f"mult={out_neg_vel:.4f}")

    # Positive velocity from 1.0 → must NOT exceed 1.0 (protective only)
    out_pos_vel = dvpid_one_step(+0.5, 1.0)
    check(out_pos_vel <= 1.0, "PID Simulation",
          "DVPID asymmetry: positive velocity never exceeds 1.0",
          f"mult={out_pos_vel:.4f}")

    # ---- SPID sign test ----
    spid_kp = fget("InpSPIDKp", 2.0)

    def spid_one_step(spread_ratio: float, current_mult: float) -> float:
        error = 1.0 - spread_ratio
        pid_out = spid_kp * error
        delta   = _pid_clamp(pid_out - (current_mult - 1.0), -0.05, 0.05)
        candidate = current_mult + delta
        return _pid_clamp(candidate, 0.5, 2.0)

    # High spread ratio > 1.0 → error < 0 → mult decreases (tighter threshold)
    out_high_spread = spid_one_step(1.5, 1.0)
    check(out_high_spread < 1.0, "PID Simulation",
          "SPID sign: high spread reduces multiplier",
          f"mult={out_high_spread:.4f}")

    # Low spread ratio < 1.0 → error > 0 → mult increases
    out_low_spread = spid_one_step(0.5, 1.0)
    check(out_low_spread > 1.0, "PID Simulation",
          "SPID sign: low spread increases multiplier",
          f"mult={out_low_spread:.4f}")

    # ---- Combined bounds test ----
    # All multipliers at minimum → result clamped to pid_min
    min_combined = _pid_clamp(pid_min * 0.3 * 0.3 * 0.1 * 0.5,
                               pid_min, pid_max)
    check(min_combined >= pid_min, "PID Simulation",
          "Combined bounds: all-min output >= InpPIDMinRisk",
          f"result={min_combined:.4f}, floor={pid_min:.4f}")

    # All multipliers at maximum → result clamped to pid_max
    max_combined = _pid_clamp(pid_max * 1.5 * 1.5 * 1.0 * 2.0,
                               pid_min, pid_max)
    check(max_combined <= pid_max, "PID Simulation",
          "Combined bounds: all-max output <= InpPIDMaxRisk",
          f"result={max_combined:.4f}, ceiling={pid_max:.4f}")


# ---------------------------------------------------------------------------
# Category 13 — Config file checks
# ---------------------------------------------------------------------------

def check_config_files(base: Path) -> None:
    ftmo_set_text = read_text(base / FTMO_SET)
    if ftmo_set_text is None:
        check(False, "Config Files",
              f"{FTMO_SET} contains Expert=FTMO_ProTrader_EA", "file not found")
        check(False, "Config Files",
              f"{FTMO_SET} contains InpFTMOMode=1 or true", "file not found")
    else:
        has_expert = bool(re.search(
            r'Expert\s*=\s*FTMO_ProTrader_EA(\.mq5)?', ftmo_set_text, re.IGNORECASE))
        check(has_expert, "Config Files",
              f"{FTMO_SET} contains Expert=FTMO_ProTrader_EA")

        has_ftmo_mode = bool(re.search(
            r'InpFTMOMode\s*=\s*(1|true)', ftmo_set_text, re.IGNORECASE))
        check(has_ftmo_mode, "Config Files",
              f"{FTMO_SET} contains InpFTMOMode=1 or true")

    max_set_text = read_text(base / MAX_SET)
    if max_set_text is None:
        warn(f"{MAX_SET} not present — skipping MAX config file checks")
    else:
        has_expert = bool(re.search(
            r'Expert\s*=\s*MAX_ProTrader_EA(\.mq5)?', max_set_text, re.IGNORECASE))
        check(has_expert, "Config Files",
              f"{MAX_SET} contains Expert=MAX_ProTrader_EA")

        has_ftmo_mode = bool(re.search(
            r'InpFTMOMode\s*=\s*(0|false)', max_set_text, re.IGNORECASE))
        check(has_ftmo_mode, "Config Files",
              f"{MAX_SET} contains InpFTMOMode=0 or false")


# ---------------------------------------------------------------------------
# Category 15 — Optimization presets (genetic-optimizer .set files)
# ---------------------------------------------------------------------------

def check_optimization_presets(base: Path) -> None:
    """Validate the genetic-optimizer .set files use the MT5
    value||start||step||stop||Y/N format, lock FTMO safety inputs, and open
    the search space on at least the core strategy + PID gains."""
    specs = [
        ("FTMO_Optimize.set", "FTMO_ProTrader_EA",
         # inputs that MUST be locked (N) so the optimizer can't break FTMO rules
         ["InpMaxDailyLoss", "InpMaxTotalLoss", "InpProfitTarget",
          "InpFTMOMode", "InpEnforceDailyLimit", "InpPIDMaxRisk"]),
        ("MAX_Optimize.set", "MAX_ProTrader_EA",
         # MAX keeps the kill-switch locked; risk ceilings may be optimized
         ["InpEnforceTotalLimit", "InpFTMOMode"]),
    ]
    # inputs that SHOULD be opened for optimization (Y) in both presets
    must_optimize = ["InpFastEMA", "InpSlowEMA", "InpATRSLMulti",
                     "InpATRTPMulti", "InpEPIDKp", "InpVPIDKp"]

    for fname, expert, locked in specs:
        text = read_text(base / fname)
        if text is None:
            check(False, "Optimization", f"{fname} exists", "file not found")
            continue
        check(True, "Optimization", f"{fname} exists")

        check(bool(re.search(rf'Expert\s*=\s*{re.escape(expert)}', text)),
              "Optimization", f"{fname}: Expert={expert}")

        check("Optimization=2" in text, "Optimization",
              f"{fname}: genetic optimization enabled (Optimization=2)")

        # Parse "Name=value||start||step||stop||flag" lines
        flags = {}
        for m in re.finditer(r'^(Inp\w+)\s*=\s*[^|]+\|\|[^|]*\|\|[^|]*\|\|[^|]*\|\|([YN])',
                             text, re.MULTILINE):
            flags[m.group(1)] = m.group(2).upper()

        check(len(flags) >= 30, "Optimization",
              f"{fname}: uses value||start||step||stop||Y/N format ({len(flags)} inputs)")

        for inp in locked:
            check(flags.get(inp) == "N", "Optimization",
                  f"{fname}: {inp} LOCKED (N) — optimizer cannot violate it",
                  f"flag={flags.get(inp)}")

        for inp in must_optimize:
            check(flags.get(inp) == "Y", "Optimization",
                  f"{fname}: {inp} opened for optimization (Y)",
                  f"flag={flags.get(inp)}")


# ---------------------------------------------------------------------------
# Category 16 — Trade-logger feature (closed-trade CSV → Monte Carlo)
# ---------------------------------------------------------------------------

def check_trade_logger(base: Path) -> None:
    core = read_text(base / "ProTrader_Core.mqh")
    if core is None:
        check(False, "Trade Logger", "ProTrader_Core.mqh exists", "file not found")
        return
    for needle, desc in [
        ("TradeLog_Init",   "Core defines TradeLog_Init (CSV header)"),
        ("TradeLog_Append", "Core defines TradeLog_Append (per-trade row)"),
        ("FileWrite",       "Core writes CSV rows via FileWrite"),
        ("InpLogTrades",    "Core gates logging behind InpLogTrades"),
    ]:
        check(needle in core, "Trade Logger", desc)

    pids = read_text(base / "ProTrader_PIDs.mqh")
    if pids is not None:
        check("PID_LastEffectiveRisk" in pids, "Trade Logger",
              "PIDs expose PID_LastEffectiveRisk for logging")

    # InpLogTrades must exist in BOTH wrappers (parity already enforced, but
    # assert the specific feature input is present)
    for fname, label in (("FTMO_ProTrader_EA.mq5", "FTMO"),
                          ("MAX_ProTrader_EA.mq5",  "MAX")):
        text = read_text(base / fname)
        check(text is not None and "InpLogTrades" in text, "Trade Logger",
              f"{label} wrapper declares InpLogTrades")


# ---------------------------------------------------------------------------
# Category 14 — Version consistency
# ---------------------------------------------------------------------------

def check_version_consistency(base: Path) -> None:
    expected_version = "5.00"
    for fname, label in (("FTMO_ProTrader_EA.mq5", "FTMO"),
                          ("MAX_ProTrader_EA.mq5",  "MAX")):
        text = read_text(base / fname)
        if text is None:
            check(False, "Version Consistency",
                  f'{label} wrapper #property version == "{expected_version}"',
                  "file not found")
            continue
        m = re.search(r'#property\s+version\s+"([^"]+)"', text)
        ver = m.group(1) if m else None
        ok  = ver == expected_version
        check(ok, "Version Consistency",
              f'{label} wrapper #property version == "{expected_version}"',
              f'got "{ver}"' if not ok else "")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main() -> int:
    base = Path(__file__).parent

    # Count total checks up-front by running a dry pass is complex; we'll
    # just announce after we know the number.
    print("Running MT5 EA static validation…")
    print()

    check_file_existence(base)
    check_include_guards(base)
    check_include_ordering(base)
    check_input_parity(base)
    check_required_inputs(base)
    check_defaults(base)
    check_ftmo_exclusivity(base)
    check_pid_symbols(base)
    check_core_functions(base)
    check_safety_features(base)
    check_bracket_balance(base)
    check_pid_simulation(base)
    check_config_files(base)
    check_optimization_presets(base)
    check_trade_logger(base)
    check_version_consistency(base)

    total   = len(_results)
    passed  = sum(1 for ok, _, _ in _results if ok)
    failed  = total - passed

    if _warnings:
        print()
        for w in _warnings:
            print(f"[WARN] {w}")

    print()
    print("═" * 47)
    print(f"  {passed}/{total} checks passed")
    if failed == 0:
        print("  RESULT: ALL CHECKS PASSED")
    else:
        print(f"  RESULT: FAILED — {failed} check{'s' if failed != 1 else ''} failed")
    print("═" * 47)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
