import type { TickerResult } from "./engine";

export type Grade = "Trust" | "Be careful" | "Do not trust";
export type Reason = { check: "peeking" | "locked" | "breadth" | "trials" | "run"; level: "fail" | "warn" | "pass"; text: string };

// ponytail: provisional thresholds. The PRD leaves these open until we see real results; tune here, the UI shows them.
export const THRESHOLDS = {
  collapseBuildSharpe: 0.5, // build Sharpe at or above this, and locked Sharpe below 0 → large collapse
  moderateGapRatio: 0.5, // locked Sharpe below half of build Sharpe → moderate gap
  breadthMin: 0.4, // fewer than 40% of stocks with positive locked Sharpe → cherry picked
};

/** Lopez de Prado / Bailey: ~7 variants on 2y of daily data, ~45 on 5y. Linear in between. */
export function trialLimit(buildYears: number) {
  if (buildYears <= 2) return 7;
  if (buildYears >= 5) return 45;
  return Math.round(7 + ((buildYears - 2) / 3) * 38);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function grade(results: TickerResult[], focus: string, trials: number, buildYears: number, suspectLines: { line: number; code: string }[]) {
  const ok = results.filter((r) => r.build && !r.error);
  const reasons: Reason[] = [];
  if (!ok.length) {
    return { grade: "Do not trust" as Grade, reasons: [{ check: "run" as const, level: "fail" as const, text: "The strategy code crashed on every stock, so nothing could be checked." }] };
  }

  // 1. Peeking: exact, behavioral. Any change → Do not trust.
  const leaks = ok.filter((r) => r.peek?.leak);
  if (leaks.length) {
    const line = suspectLines[0];
    const first = leaks.find((r) => r.ticker === focus) ?? leaks[0];
    reasons.push({
      check: "peeking",
      level: "fail",
      text: `Peeked at tomorrow's price${line ? ` on line ${line.line}` : ""}. With the future hidden after ${first.peek?.cutoff}, its decision on ${first.peek?.first_changed} changed. Caught on ${leaks.length} of ${ok.length} stocks.`,
    });
    reasons.push({ check: "locked", level: "fail", text: "Every return number above is meaningless while the code reads the future, including the locked period." });
    return { grade: "Do not trust" as Grade, reasons };
  } else {
    reasons.push({ check: "peeking", level: "pass", text: `No peeking. Past decisions stayed the same with the future hidden at ${ok[0].peek?.cutoffs ?? 50} cutoff dates on every stock.` });
  }

  // 2. Locked period, on the stock the user named.
  const f = ok.find((r) => r.ticker === focus) ?? ok[0];
  const b = f.build!;
  const l = f.locked;
  if (l && Object.keys(l).length) {
    const msg = `${f.ticker}: Sharpe ${b.sharpe.toFixed(2)} in the build period, ${l.sharpe.toFixed(2)} in the locked period the AI never saw (return ${pct(l.return)} vs buy and hold ${pct(l.buy_hold)}).`;
    if (b.sharpe >= THRESHOLDS.collapseBuildSharpe && l.sharpe < 0) reasons.push({ check: "locked", level: "fail", text: `Large collapse. ${msg}` });
    else if (l.sharpe < b.sharpe * THRESHOLDS.moderateGapRatio) reasons.push({ check: "locked", level: "warn", text: `Weaker on unseen data. ${msg}` });
    else reasons.push({ check: "locked", level: "pass", text: `Held up on unseen data. ${msg}` });
  }

  // 3. Breadth across the 30 stocks.
  const works = ok.filter((r) => r.locked && (r.locked.sharpe ?? 0) > 0).length;
  const share = works / ok.length;
  reasons.push({
    check: "breadth",
    level: share < THRESHOLDS.breadthMin ? "warn" : "pass",
    text: `Worked on ${works} of ${ok.length} stocks in the locked period${share < THRESHOLDS.breadthMin ? ", so the result on one stock may be cherry picked" : ""}.`,
  });

  // 4. Trials.
  const limit = trialLimit(buildYears);
  reasons.push({
    check: "trials",
    level: trials > limit ? "warn" : "pass",
    text:
      trials > limit
        ? `${trials} variants tried. On ${buildYears.toFixed(0)} years of data, more than ${limit} makes a good backtest likely by luck alone.`
        : `${trials} of ${limit} variants used before luck alone starts to explain a good backtest.`,
  });

  const g: Grade = reasons.some((r) => r.level === "fail") ? "Do not trust" : reasons.some((r) => r.level === "warn") ? "Be careful" : "Trust";
  return { grade: g, reasons };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = { return: 1, cagr: 0.1, sharpe: 1, max_drawdown: -0.2, trades: 10, buy_hold: 0.5, exposure: 0.5 };
  const mk = (t: string, leak: boolean, ls: number): TickerResult => ({ ticker: t, build: s, locked: { ...s, sharpe: ls }, peek: { leak, cutoff: "2020-01-02", first_changed: "2020-01-02" } });
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  assert(grade([mk("COST", true, 1)], "COST", 1, 10, [{ line: 14, code: "x" }]).grade === "Do not trust", "leak");
  assert(grade([mk("COST", false, 1)], "COST", 1, 10, []).grade === "Trust", "clean");
  assert(grade([mk("COST", false, -0.5)], "COST", 1, 10, []).grade === "Do not trust", "collapse");
  assert(grade([mk("COST", false, 1)], "COST", 50, 10, []).grade === "Be careful", "trials");
  assert(trialLimit(2) === 7 && trialLimit(5) === 45 && trialLimit(10) === 45, "limits");
  console.log("verdict ok");
}
