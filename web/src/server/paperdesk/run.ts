import "server-only";

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { explain, honestVariants, injectBug, MODEL, planToStrategy } from "./agent";
import { type EngineEvent, runStrategy, type TickerResult } from "./engine";
import { arizeUrl, evalAttrs, startTrace } from "./trace";
import { grade, THRESHOLDS, trialLimit } from "./verdict";

// Locked period starts after the model's training cutoff. Set to your model's documented cutoff.
export const LOCK_DATE = process.env.PAPERDESK_LOCK_DATE ?? "2026-01-01";
const DATA_START = "2016-01-04";
const BUILD_YEARS = (Date.parse(LOCK_DATE) - Date.parse(DATA_START)) / (365.25 * 864e5);

// ponytail: JSON file store. Swap for a DB when there is more than one server.
const FILE = path.join(process.cwd(), ".data", "store.json");
type Seal = { hash: string; sealedAt: string; runId: string; plan: string; title: string; ticker: string; grade: string; reasons: string[]; headline: number; order?: unknown };
type Store = { trials: number; seals: Seal[] };
const load = (): Store => {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return { trials: 0, seals: [] };
  }
};
const save = (s: Store) => {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
};
export const getStore = load;
export const resetTrials = () => save({ ...load(), trials: 0 });

const g = globalThis as unknown as { __pdRuns?: Map<string, unknown> };
const runs = (g.__pdRuns ??= new Map<string, unknown>());

export type Report = Awaited<ReturnType<typeof evaluate>>;

async function evaluate(
  s: { ticker: string; title: string; code: string },
  plan: string,
  injected: boolean,
  tr: ReturnType<typeof startTrace>,
  onEvent?: (e: EngineEvent) => void,
  sandboxes?: number,
) {
  const t0 = Date.now();
  const out = await tr.step(
    "daytona.run_30_stocks",
    "TOOL",
    { ticker: s.ticker, lock_date: LOCK_DATE, injected },
    () => runStrategy({ code: s.code, focus: s.ticker, lockDate: LOCK_DATE, onEvent, sandboxes }),
    (o) => ({
      mode: o.mode,
      sandboxes: o.sandboxes.length,
      avg_sandbox_start_ms: avg(o.sandboxes.map((x) => x.startMs)),
      stocks_ok: o.results.filter((r) => r.build).length,
      leaks: o.results.filter((r) => r.peek?.leak).map((r) => r.ticker),
      suspect_lines: o.suspectLines,
      error: o.error,
    }),
  );
  const store = load();
  store.trials += 1;
  save(store);
  const v = await tr.step(
    "referee.verdict",
    "EVALUATOR",
    { trials: store.trials, build_years: Number(BUILD_YEARS.toFixed(1)) },
    async () => grade(out.results, s.ticker, store.trials, BUILD_YEARS, out.suspectLines),
    (r) => ({ grade: r.grade, reasons: r.reasons.map((x) => x.text) }),
  );
  const focus = out.results.find((r) => r.ticker === s.ticker);
  const id = `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const report = {
    id,
    plan,
    title: s.title,
    ticker: s.ticker,
    code: s.code,
    injected,
    mode: out.mode,
    error: out.error,
    grade: v.grade,
    reasons: v.reasons,
    headline: { build: focus?.build?.return ?? 0, locked: focus?.locked?.return ?? 0, buildBH: focus?.build?.buy_hold ?? 0 },
    focus: focus ?? null,
    table: out.results.map(({ curve, bars, trades, ...r }) => r) as TickerResult[],
    suspectLines: out.suspectLines,
    trials: store.trials,
    trialLimit: trialLimit(BUILD_YEARS),
    lockDate: LOCK_DATE,
    buildYears: BUILD_YEARS,
    thresholds: THRESHOLDS,
    sandboxes: out.sandboxes,
    totalMs: Date.now() - t0,
    traceId: tr.traceId,
    rootSpanId: tr.rootSpanId,
    steps: tr.steps,
    arizeUrl,
    model: MODEL,
  };
  runs.set(id, report);
  return report;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export async function runPlan(plan: string, inject: boolean, onEvent?: (e: { type: "strategy"; title: string; ticker: string; code: string } | EngineEvent) => void) {
  const tr = startTrace("paper_desk.verdict", { plan, inject_bug: inject });
  try {
    // Pasted code skips the agent (for developers who already have a strategy).
    const pasted = plan.includes("def strategy(") ? { ticker: plan.match(/#\s*ticker:\s*([A-Z]+)/)?.[1] ?? "COST", title: "Pasted strategy", code: plan } : null;
    const s = pasted ?? (await tr.step("agent.plan_to_strategy", "LLM", { plan, model: MODEL }, () => planToStrategy(plan), (r) => ({ ticker: r.ticker, title: r.title, code: r.code })));
    if (inject) s.code = injectBug(s.code);
    onEvent?.({ type: "strategy", title: s.title, ticker: s.ticker, code: s.code });
    const report = await evaluate(s, plan, inject, tr, onEvent);
    tr.end({ grade: report.grade }, evalAttrs("paper_desk_verdict", report.grade, report.grade === "Trust" ? 1 : report.grade === "Be careful" ? 0.5 : 0, report.reasons.map((r) => r.text).join(" ")));
    return report;
  } catch (e) {
    tr.end({ error: String(e) });
    throw e;
  }
}

export async function runVariants(plan: string) {
  const tr = startTrace("paper_desk.fix_it", { plan });
  const vs = await tr.step("agent.honest_variants", "LLM", { plan, model: MODEL }, () => honestVariants(plan, 4), (r) => ({ titles: r.map((x) => x.title) }));
  // 4 variants x 2 sandboxes = 8, under Daytona's default 10-CPU concurrency limit.
  const reports = await Promise.all(vs.map((v) => evaluate(v, plan, false, tr, undefined, 2)));
  tr.end({ grades: reports.map((r) => r.grade) });
  return reports;
}

/** The "why" answer is built from the run record, then checked against it: every number it quotes must exist in the record. */
export async function why(runId: string, question: string) {
  const r = runs.get(runId) as Report | undefined;
  if (!r) throw new Error("run not found (server restarted?)");
  const record = { plan: r.plan, grade: r.grade, reasons: r.reasons.map((x) => x.text), trace: r.steps.map((s) => ({ step: s.name, ms: s.ms, ...s.attrs })) };
  const tr = startTrace("paper_desk.why", { runId, question });
  const answer = await tr.step("agent.explain_from_trace", "LLM", { question, record_trace_id: r.traceId }, () => explain(record, question), (a) => ({ answer: a }));
  const nums = (t: string) => new Set((t.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
  const have = nums(JSON.stringify(record));
  const unmatched = [...nums(answer)].filter((n) => !have.has(n));
  const grounded = unmatched.length === 0;
  await tr.step("check.why_grounded_in_trace", "EVALUATOR", { unmatched }, async () => grounded, (ok) => ({ grounded: ok }));
  tr.end(
    { answer, grounded },
    evalAttrs("why_grounded_in_trace", grounded ? "grounded" : "ungrounded", grounded ? 1 : 0, unmatched.length ? `numbers not in trace: ${unmatched.join(", ")}` : "every number appears in the trace"),
  );
  return { answer, grounded, unmatched, traceId: r.traceId };
}

export async function seal(runId: string) {
  const r = runs.get(runId) as Report | undefined;
  if (!r) throw new Error("run not found (server restarted?)");
  const sealedAt = new Date().toISOString();
  const body = { plan: r.plan, code: r.code, grade: r.grade, reasons: r.reasons.map((x) => x.text), headline: r.headline, lockDate: r.lockDate, sealedAt };
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  let order: unknown = null;
  if (process.env.ALPACA_API_KEY) {
    // Paper endpoint only. Never the live URL.
    const res = await fetch("https://paper-api.alpaca.markets/v2/orders", {
      method: "POST",
      headers: { "APCA-API-KEY-ID": process.env.ALPACA_API_KEY, "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({ symbol: r.ticker, qty: 1, side: "buy", type: "market", time_in_force: "day", client_order_id: hash.slice(0, 40) }),
    });
    const j = (await res.json()) as { id?: string; status?: string; message?: string };
    order = res.ok ? { id: j.id, status: j.status, symbol: r.ticker, qty: 1 } : { error: j.message ?? res.statusText };
  }
  const store = load();
  const s: Seal = { hash, sealedAt, runId, plan: r.plan, title: r.title, ticker: r.ticker, grade: r.grade, reasons: body.reasons, headline: r.headline.build, order };
  store.seals.unshift(s);
  save(store);
  return s;
}
