"""Paper Desk referee. Runs inside an isolated Daytona sandbox (network blocked, no keys).

usage: python runner.py <prices_dir> <strategy.py> <lock_date> <focus> TICKER [TICKER ...]
Prints one JSON line prefixed with RESULT: on stdout.

Contract for strategy.py:  def strategy(df) -> pd.Series of target positions (0..1)
indexed like df. position[t] is decided at the close of day t and held on day t+1.
"""
import importlib.util, json, math, re, sys, traceback

import numpy as np
import pandas as pd

# Code patterns that read later rows. Used only to *name the line*; the verdict comes from the behavioral test.
FUTURE_PATTERNS = re.compile(r"shift\(\s*-|\.iloc\[[^\]]*\+\s*\d|\[\s*i\s*\+\s*\d|\.lead\(|tomorrow|future|next_close")


def load_strategy(path):
    spec = importlib.util.spec_from_file_location("user_strategy", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.strategy


def positions(strategy, df):
    pos = strategy(df.copy())
    pos = pd.Series(pos, index=df.index) if not isinstance(pos, pd.Series) else pos.reindex(df.index)
    return pos.astype(float).fillna(0).clip(-1, 1)


def stats(pos, close):
    ret = close.pct_change().fillna(0)
    strat = (pos.shift(1).fillna(0) * ret)
    eq = (1 + strat).cumprod()
    years = max(len(strat) / 252, 1e-9)
    sd = strat.std()
    return {
        "return": float(eq.iloc[-1] - 1),
        "cagr": float(eq.iloc[-1] ** (1 / years) - 1) if eq.iloc[-1] > 0 else -1.0,
        "sharpe": float(strat.mean() / sd * math.sqrt(252)) if sd > 0 else 0.0,
        "max_drawdown": float((eq / eq.cummax() - 1).min()),
        "trades": int((pos.diff().abs() > 0).sum()),
        "buy_hold": float(close.iloc[-1] / close.iloc[0] - 1),
        "exposure": float((pos != 0).mean()),
    }, eq


def log(msg):
    # Streamed live to the dashboard's sandbox wall (Daytona session logs).
    print("LOG " + msg, flush=True)


def peek_test(strategy, df, full_pos, lock_date, ticker=""):
    """Rerun with the future hidden at several cutoffs. Any change in a past decision = the code read the future."""
    # ponytail: 50 evenly spaced cutoffs; a 1-day lookahead only shows on the cutoff day itself,
    # so coverage scales with cutoff count. Raise N if a subtle leak slips through.
    idx = df.index[60:]
    cuts = [idx[int(len(idx) * k / 50)] for k in range(50)]
    for k, cut in enumerate(cuts):
        if k % 10 == 0:
            log(f"{ticker} peek {k}/50 · cut {cut.date()}")
        part = positions(strategy, df[df.index <= cut])
        diff = (part - full_pos.loc[part.index]).abs() > 1e-9
        if diff.any():
            first = diff.idxmax()
            return {"leak": True, "cutoff": str(cut.date()), "first_changed": str(first.date()),
                    "changed_days": int(diff.sum()), "checked_days": int(len(part))}
    return {"leak": False, "cutoffs": len(cuts)}


def run_one(strategy, prices_dir, ticker, lock_date, with_curve):
    df = pd.read_csv(f"{prices_dir}/{ticker}.csv", parse_dates=["date"], index_col="date")
    pos = positions(strategy, df)
    b, l = df.index < lock_date, df.index >= lock_date
    build, _ = stats(pos[b], df.close[b])
    locked, _ = stats(pos[l], df.close[l]) if l.sum() > 5 else ({}, None)
    log(f"{ticker} {len(df)} days · sharpe {build['sharpe']:.2f}")
    peek = peek_test(strategy, df, pos, lock_date, ticker)
    log(f"{ticker} LEAK · {peek['first_changed']} changed" if peek["leak"] else f"{ticker} clean · 50/50 held")
    out = {"ticker": ticker, "build": build, "locked": locked, "peek": peek}
    if with_curve:
        _, eq = stats(pos, df.close)
        bh = df.close / df.close.iloc[0]
        step = slice(None, None, 3)  # downsample for the wire
        out["curve"] = [{"d": str(d.date()), "s": round(float(s), 4), "b": round(float(h), 4)}
                        for d, s, h in zip(eq.index[step], eq.values[step], bh.values[step])]
        out["bars"] = [{"time": str(d.date()), "open": o, "high": h, "low": lo, "close": c}
                       for d, o, h, lo, c in zip(df.index, df.open, df.high, df.low, df.close)]
        chg = pos.diff().fillna(pos)
        out["trades"] = [{"time": str(d.date()), "side": "buy" if v > 0 else "sell"} for d, v in chg[chg != 0].items()]
    return out


def main():
    prices_dir, strat_path, lock_date, focus, *tickers = sys.argv[1:]
    lock_date = pd.Timestamp(lock_date)
    code = open(strat_path).read().splitlines()
    suspect = [{"line": i + 1, "code": s.strip()} for i, s in enumerate(code) if FUTURE_PATTERNS.search(s)]
    results = []
    log(f"python {sys.version.split()[0]} · pandas {pd.__version__}")
    log(f"loading strategy.py ({len(code)} lines)")
    try:
        strategy = load_strategy(strat_path)
    except Exception:
        print("RESULT:" + json.dumps({"error": traceback.format_exc(limit=2), "results": []}))
        return
    for t in tickers:
        try:
            results.append(run_one(strategy, prices_dir, t, lock_date, t == focus))
        except Exception:
            results.append({"ticker": t, "error": traceback.format_exc(limit=2)})
            log(f"{t} crashed")
    print("RESULT:" + json.dumps({"suspect_lines": suspect, "results": results}))


if __name__ == "__main__":
    main()
