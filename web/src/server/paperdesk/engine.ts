import "server-only";

import { Daytona } from "@daytonaio/sdk";

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export const ENGINE_DIR = path.resolve(process.cwd(), "../engine");
export const TICKERS = [
  "COST",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "NVDA",
  "TSLA",
  "JPM",
  "V",
  "JNJ",
  "WMT",
  "PG",
  "XOM",
  "UNH",
  "HD",
  "KO",
  "PEP",
  "MRK",
  "ABBV",
  "CVX",
  "BAC",
  "DIS",
  "NFLX",
  "ADBE",
  "CRM",
  "INTC",
  "CSCO",
  "MCD",
  "NKE",
];

export type Stats = {
  return: number;
  cagr: number;
  sharpe: number;
  max_drawdown: number;
  trades: number;
  buy_hold: number;
  exposure: number;
};
export type TickerResult = {
  ticker: string;
  error?: string;
  build?: Stats;
  locked?: Stats;
  peek?: { leak: boolean; cutoff?: string; first_changed?: string; changed_days?: number; cutoffs?: number };
  curve?: { d: string; s: number; b: number }[];
  bars?: { time: string; open: number; high: number; low: number; close: number }[];
  trades?: { time: string; side: "buy" | "sell" }[];
};
export type EngineOutput = {
  mode: "daytona" | "local";
  results: TickerResult[];
  suspectLines: { line: number; code: string }[];
  sandboxes: { id: string; tickers: string[]; startMs: number; runMs: number }[];
  error?: string;
};
export type EngineEvent =
  | {
      type: "sandbox";
      id: string;
      tickers: string[];
      status: "starting" | "running" | "done" | "error";
      ms?: number;
      sandboxId?: string;
    }
  | { type: "log"; id: string; line: string }
  | { type: "ticker"; result: TickerResult };

const SANDBOXES = Number(process.env.PAPERDESK_SANDBOXES ?? 10);
const SNAPSHOT = process.env.DAYTONA_SNAPSHOT ?? "paper-desk";

function parse(stdout: string) {
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  if (!line) throw new Error(`runner produced no result:\n${stdout.slice(-2000)}`);
  return JSON.parse(line.slice(7)) as {
    results: TickerResult[];
    suspect_lines: EngineOutput["suspectLines"];
    error?: string;
  };
}

function chunk<T>(xs: T[], n: number) {
  const size = Math.ceil(xs.length / n);
  return Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));
}

export async function runStrategy(opts: {
  code: string;
  tickers?: string[];
  focus: string;
  lockDate: string;
  onEvent?: (e: EngineEvent) => void;
  sandboxes?: number;
}): Promise<EngineOutput> {
  const { code, focus, lockDate, onEvent = () => {} } = opts;
  const tickers = opts.tickers ?? TICKERS;
  const groups = chunk(tickers, opts.sandboxes ?? SANDBOXES);
  const useDaytona = !!process.env.DAYTONA_API_KEY;
  const daytona = useDaytona ? new Daytona() : null;
  const runner = readFileSync(path.join(ENGINE_DIR, "runner.py"));

  const runGroup = async (group: string[], i: number) => {
    const id = `sbx-${i + 1}`;
    onEvent({ type: "sandbox", id, tickers: group, status: "starting" });
    const t0 = Date.now();
    const args = ["prices", "strategy.py", lockDate, focus, ...group];
    if (!daytona) {
      // ponytail: local fallback when no DAYTONA_API_KEY — same runner, no isolation. Dev only.
      const dir = path.join(ENGINE_DIR, ".tmp", `${Date.now()}-${i}`);
      const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "strategy.py"), code);
      onEvent({ type: "sandbox", id, tickers: group, status: "running" });
      const { stdout } = await promisify(execFile)(
        path.join(ENGINE_DIR, ".venv/bin/python"),
        [
          path.join(ENGINE_DIR, "runner.py"),
          path.join(ENGINE_DIR, "prices"),
          path.join(dir, "strategy.py"),
          ...args.slice(2),
        ],
        { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
      );
      rmSync(dir, { recursive: true, force: true });
      for (const l of stdout.split("\n")) if (l.startsWith("LOG ")) onEvent({ type: "log", id, line: l.slice(4) });
      return { id, group, startMs: 0, runMs: Date.now() - t0, out: parse(stdout) };
    }
    // Network blocked, no env/keys passed in, auto-deleted after the run.
    const create = () =>
      daytona.create({ snapshot: SNAPSHOT, networkBlockAll: true, ephemeral: true, autoStopInterval: 5 });
    // 10 sandboxes = the whole 10-CPU org limit, so sandboxes still deleting from the last run can block a few. Wait and retry.
    let sandbox: Awaited<ReturnType<typeof create>> | undefined;
    for (let i = 0; !sandbox; i++) {
      try {
        sandbox = await create();
      } catch (e) {
        if (i >= 8 || !/CPU limit/i.test(String(e))) throw e;
        if (i === 0) onEvent({ type: "log", id, line: "waiting for a free Daytona CPU…" });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const startMs = Date.now() - t0;
    try {
      onEvent({ type: "sandbox", id, tickers: group, status: "running", ms: startMs, sandboxId: sandbox.id });
      onEvent({
        type: "log",
        id,
        line: `sandbox ${sandbox.id.slice(0, 8)} up in ${startMs} ms · network blocked · no keys`,
      });
      await sandbox.fs.uploadFiles([
        { source: runner, destination: "/home/daytona/runner.py" },
        { source: Buffer.from(code), destination: "/home/daytona/strategy.py" },
      ]);
      // Async session command so stdout streams to the dashboard while it runs.
      await sandbox.process.createSession("run");
      const { cmdId } = await sandbox.process.executeSessionCommand("run", {
        command: `cd /home/daytona && python runner.py ${args.join(" ")}`,
        runAsync: true,
      });
      let buf = "";
      const onChunk = (c: string) => {
        buf += c;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.startsWith("LOG ")) onEvent({ type: "log", id, line: l.slice(4) });
      };
      await sandbox.process.getSessionCommandLogs("run", cmdId!, onChunk, onChunk);
      const { stdout } = await sandbox.process.getSessionCommandLogs("run", cmdId!);
      return { id, group, startMs, runMs: Date.now() - t0 - startMs, out: parse(stdout ?? "") };
    } finally {
      daytona.delete(sandbox).catch(() => {});
    }
  };

  const settled = await Promise.allSettled(
    groups.map(async (g, i) => {
      try {
        const r = await runGroup(g, i);
        for (const t of r.out.results) onEvent({ type: "ticker", result: t });
        onEvent({ type: "sandbox", id: r.id, tickers: g, status: "done", ms: r.startMs + r.runMs });
        return r;
      } catch (e) {
        onEvent({ type: "sandbox", id: `sbx-${i + 1}`, tickers: g, status: "error" });
        throw e;
      }
    }),
  );
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const failed = settled.flatMap((s) => (s.status === "rejected" ? [String(s.reason)] : []));
  return {
    mode: daytona ? "daytona" : "local",
    results: ok.flatMap((r) => r.out.results),
    suspectLines: ok[0]?.out.suspect_lines ?? [],
    sandboxes: ok.map((r) => ({ id: r.id, tickers: r.group, startMs: r.startMs, runMs: r.runMs })),
    error: ok.find((r) => r.out.error)?.out.error ?? failed[0],
  };
}
