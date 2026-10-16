"use client";

import { useEffect, useRef, useState } from "react";

import {
  Activity,
  Bug,
  ChartLine,
  CircleCheck,
  CircleX,
  ExternalLink,
  FlaskConical,
  Info,
  MessageSquareText,
  Play,
  RotateCcw,
  ShieldCheck,
  Stamp,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { EngineEvent } from "@/server/paperdesk/engine";
import type { Report } from "@/server/paperdesk/run";

import { BreadthChart, EquityChart, PriceChart, pct } from "./charts";
import { type Box, LiveRun, type Marks, type TickerState } from "./live";

const EXAMPLES = [
  "Buy Costco when it drops 5%, sell after 10%.",
  "Buy Apple when its 50-day average crosses above the 200-day, sell when it crosses back.",
  "Buy Nvidia after 3 down days in a row, sell after 5 days.",
];
const GRADE_STYLE = {
  Trust: { color: "text-green-600 dark:text-green-400", ring: "border-green-600", icon: CircleCheck },
  "Be careful": { color: "text-amber-600 dark:text-amber-400", ring: "border-amber-500", icon: TriangleAlert },
  "Do not trust": { color: "text-red-600 dark:text-red-400", ring: "border-red-600", icon: CircleX },
} as const;
const MEANING = {
  Trust: "Passed every check. The result looks real, not a fluke and not cheating.",
  "Be careful": "Some checks raised flags. Read the reasons before you rely on it.",
  "Do not trust": "Failed a check. Do not believe this backtest.",
} as const;
const TAB_HELP: Record<string, string> = {
  live: "Each box is a real Daytona computer, cut off from the internet, testing your plan on 3 stocks.",
  performance: "How the plan would have traded, and whether the same rule works on other stocks.",
  why: "Ask why it got this verdict. The answer comes only from the recorded run, and every number is checked.",
  fix: "Claude writes 4 honest versions of your plan and tests each one the same way.",
  seal: "Lock this verdict with a date and fingerprint so nobody can edit it later. Share the card.",
};
const DISCLAIMER = "Practice only. Not financial advice. Past results do not predict future results.";

type Seal = { hash: string; sealedAt: string; order?: { id?: string; status?: string; error?: string } | null };

export function Desk() {
  const [plan, setPlan] = useState(EXAMPLES[0]);
  const [inject, setInject] = useState(false);
  const [running, setRunning] = useState(false);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [tickers, setTickers] = useState<Record<string, TickerState>>({});
  const [marks, setMarks] = useState<Marks | null>(null);
  const [tab, setTab] = useState("live");
  const [strategy, setStrategy] = useState<{ title: string; ticker: string; code: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function run() {
    setRunning(true);
    setReport(null);
    setStrategy(null);
    setBoxes({});
    setTickers({});
    setMarks({ start: Date.now() });
    setTab("live");
    try {
      const res = await fetch("/api/run", { method: "POST", body: JSON.stringify({ plan, injectBug: inject }) });
      if (!res.body) throw new Error(await res.text());
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines.filter(Boolean)) {
          const e = JSON.parse(l) as
            | EngineEvent
            | { type: "strategy"; title: string; ticker: string; code: string }
            | { type: "report"; report: Report }
            | { type: "error"; error: string };
          const now = Date.now();
          if (e.type === "strategy") {
            setStrategy(e);
            setMarks((m) => (m ? { ...m, strategy: now } : m));
          } else if (e.type === "sandbox")
            setBoxes((b) => {
              const prev = b[e.id] ?? { id: e.id, tickers: e.tickers, startedAt: now, lines: [] };
              const end = e.status === "done" || e.status === "error";
              return {
                ...b,
                [e.id]: {
                  ...prev,
                  status: e.status,
                  sandboxId: e.sandboxId ?? prev.sandboxId,
                  endedAt: end ? now : undefined,
                  lines: e.status === "error" ? [...prev.lines, "crashed"] : prev.lines,
                },
              };
            });
          else if (e.type === "log")
            setBoxes((b) => (b[e.id] ? { ...b, [e.id]: { ...b[e.id], lines: [...b[e.id].lines, e.line] } } : b));
          else if (e.type === "ticker")
            setTickers((t) => ({
              ...t,
              [e.result.ticker]: {
                status: e.result.error ? "error" : "done",
                locked: e.result.locked?.return,
                leak: e.result.peek?.leak,
              },
            }));
          else if (e.type === "report") {
            setReport(e.report);
            setMarks((m) => (m ? { ...m, report: now } : m));
          } else if (e.type === "error") toast.error(e.error.slice(0, 300));
        }
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl tracking-tight">Desk</h1>
          <p className="text-muted-foreground text-sm">
            Describe a trading plan. We turn it into code, test it on 30 stocks, and tell you whether to trust the
            backtest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-7 gap-1.5 px-2.5">
            <ShieldCheck className="size-3.5" /> Paper money only
          </Badge>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                <Info /> What we claim
              </Button>
            </SheetTrigger>
            <SheetContent className="gap-0">
              <SheetHeader>
                <SheetTitle>What we really have</SheetTitle>
                <SheetDescription>And what we do not claim.</SheetDescription>
              </SheetHeader>
              <div className="px-4">
                <SafetyPanel />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <Steps step={report ? 4 : strategy ? 3 : running ? 2 : 1} done={!!report} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHeader>
            <CardTitle className="font-normal">Your plan</CardTitle>
            <CardDescription>Plain English is fine. Or pick an example.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              rows={3}
              maxLength={2000}
              aria-label="Trading plan"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => (
                <Button key={x} size="xs" variant="outline" onClick={() => setPlan(x)} className="max-w-full truncate">
                  {x.length > 42 ? `${x.slice(0, 42)}…` : x}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
              <div className="flex items-start gap-2">
                <Bug className="mt-0.5 size-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <Label htmlFor="inject">Demo: plant a cheating line</Label>
                  <span className="text-muted-foreground text-xs">
                    Adds one line that peeks at tomorrow's price, to show the checker catches it.
                  </span>
                </div>
              </div>
              <Switch id="inject" checked={inject} onCheckedChange={setInject} />
            </div>
            <Button onClick={run} disabled={running || !plan.trim()} size="lg">
              {running ? <Spinner /> : <Play />}
              {running ? "Testing…" : "Test my plan"}
            </Button>
          </CardContent>
        </Card>

        <VerdictCard report={report} running={running} strategy={strategy} onTab={setTab} />
      </div>

      {report && <Kpis report={report} />}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
          <TabsTrigger value="live" className="flex-none px-3">
            <Activity /> Live run {running && <Spinner className="size-3" />}
          </TabsTrigger>
          <TabsTrigger value="performance" disabled={!report} className="flex-none px-3">
            <ChartLine /> Charts
          </TabsTrigger>
          <TabsTrigger value="why" disabled={!report} className="flex-none px-3">
            <MessageSquareText /> Why &amp; code
          </TabsTrigger>
          <TabsTrigger value="fix" disabled={!report} className="flex-none px-3">
            <Wrench /> Fix it
          </TabsTrigger>
          <TabsTrigger value="seal" disabled={!report} className="flex-none px-3">
            <Stamp /> Seal &amp; share
          </TabsTrigger>
        </TabsList>
        <p className="-mt-1 text-muted-foreground text-sm">{TAB_HELP[tab]}</p>

        <TabsContent value="live">
          <LiveRun boxes={boxes} tickers={tickers} marks={marks} running={running} report={report} />
        </TabsContent>

        {report && (
          <>
            <TabsContent value="performance" className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <Card className="xl:col-span-12">
                <CardHeader>
                  <CardTitle className="font-normal">{report.ticker} with the strategy's trades</CardTitle>
                  <CardDescription>
                    Daily candles. Green arrows buy, red arrows sell. Purple marks the start of the locked period.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.focus?.bars ? (
                    <PriceChart report={report} />
                  ) : (
                    <Placeholder text="No price data for this run." />
                  )}
                </CardContent>
              </Card>
              <Card className="xl:col-span-7">
                <CardHeader>
                  <CardTitle className="font-normal">Growth of $1</CardTitle>
                  <CardDescription>
                    Strategy vs buy and hold on {report.ticker}. Log scale. Shaded = locked period, after the model's
                    training cutoff.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <EquityChart report={report} />
                </CardContent>
              </Card>
              <Card className="xl:col-span-5">
                <CardHeader>
                  <CardTitle className="font-normal">Same rule, 30 stocks</CardTitle>
                  <CardDescription>Sharpe in the locked period. Green worked, red did not.</CardDescription>
                </CardHeader>
                <CardContent>
                  <BreadthChart report={report} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="why" className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <WhyPanel report={report} />
              <CodePanel report={report} />
            </TabsContent>

            <TabsContent value="fix" className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <FixIt report={report} />
            </TabsContent>

            <TabsContent value="seal" className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              <SealCard report={report} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <p className="text-center text-muted-foreground text-xs">{DISCLAIMER}</p>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <Empty className="h-64 border border-dashed">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function VerdictCard({
  report,
  running,
  strategy,
  onTab,
}: {
  report: Report | null;
  running: boolean;
  strategy: { title: string; ticker: string } | null;
  onTab: (t: string) => void;
}) {
  if (!report)
    return (
      <Card className="xl:col-span-7">
        <CardHeader>
          <CardTitle className="font-normal">Verdict</CardTitle>
          <CardDescription>
            {strategy
              ? `${strategy.title} · ${strategy.ticker}`
              : "Can you trust this backtest? Trust, Be careful, or Do not trust, with plain reasons."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="h-48 border border-dashed">
            <EmptyHeader>
              {running ? (
                <Spinner className="mx-auto size-6" />
              ) : (
                <FlaskConical className="mx-auto size-6 text-muted-foreground" />
              )}
              <EmptyTitle>
                {running
                  ? strategy
                    ? "Sandboxes are running the strategy…"
                    : "The agent is writing the strategy…"
                  : "No verdict yet"}
              </EmptyTitle>
              {!running && (
                <EmptyDescription>Write a plan and press Test my plan. It takes about 30 seconds.</EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  const s = GRADE_STYLE[report.grade];
  const Icon = s.icon;
  return (
    <Card className="xl:col-span-7">
      <CardHeader>
        <CardTitle className="font-normal">
          {report.title} · {report.ticker}
        </CardTitle>
        <CardDescription>
          Verdict on your backtest
          {report.injected && (
            <Badge variant="destructive" className="ml-2">
              planted bug
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className={`flex items-center gap-3 font-medium text-4xl tracking-tight ${s.color}`}>
              <Icon className="size-9" />
              {report.grade}
            </div>
            {report.grade === "Do not trust" && (
              <div
                aria-hidden
                className="rotate-[-8deg] rounded-md border-4 border-red-600 px-2 py-0.5 font-black text-lg text-red-600 uppercase tracking-widest opacity-85"
              >
                {report.reasons.find((r) => r.check === "peeking" && r.level === "fail")
                  ? `Peeked${report.suspectLines[0] ? ` · line ${report.suspectLines[0].line}` : ""}`
                  : "Do not trust"}
              </div>
            )}
          </div>
          <p className="text-muted-foreground text-sm">{MEANING[report.grade]}</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span>
            Backtest return <b className="tabular-nums">{pct(report.headline.build, 0)}</b>
          </span>
          <span className="text-muted-foreground">
            Just holding {report.ticker}: <span className="tabular-nums">{pct(report.headline.buildBH, 0)}</span>
          </span>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {report.reasons.map((r) => (
            <li key={r.check} className="flex gap-2">
              {r.level === "fail" ? (
                <CircleX className="mt-0.5 size-4 shrink-0 text-red-600" />
              ) : r.level === "warn" ? (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
              ) : (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
              )}
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onTab("why")}>
            <MessageSquareText /> Why this verdict?
          </Button>
          {report.grade !== "Trust" && (
            <Button size="sm" variant="outline" onClick={() => onTab("fix")}>
              <Wrench /> Fix it
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onTab("seal")}>
            <Stamp /> Seal &amp; share
          </Button>
        </div>
        {report.error && <p className="text-destructive text-xs">{report.error.slice(0, 300)}</p>}
        <p className="text-muted-foreground text-xs">
          Trust means it survived our tests, not that it will make money. {DISCLAIMER}
        </p>
      </CardContent>
    </Card>
  );
}

function Kpis({ report }: { report: Report | null }) {
  const f = report?.focus;
  const avgStart = report?.sandboxes.length
    ? Math.round(report.sandboxes.reduce((a, b) => a + b.startMs, 0) / report.sandboxes.length)
    : null;
  const items = [
    {
      label: `Backtest, 2016 to ${report?.lockDate.slice(0, 4) ?? "lock"}`,
      value: f?.build ? pct(f.build.return) : "—",
      sub: "Years the AI may have seen. Sharpe " + (f?.build ? f.build.sharpe.toFixed(2) : "—"),
    },
    {
      label: `Unseen data, since ${report?.lockDate.slice(0, 7) ?? "lock"}`,
      value: f?.locked?.return !== undefined ? pct(f.locked.return) : "—",
      sub: "After the AI's training cutoff. The real test.",
    },
    {
      label: "Daytona computers",
      value: report ? `${report.sandboxes.length}` : "—",
      sub: report
        ? report.mode === "daytona"
          ? `avg start ${avgStart} ms · total ${(report.totalMs / 1000).toFixed(1)} s`
          : "local mode, no Daytona key"
        : "network blocked, no keys",
    },
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="grid grid-cols-1 md:grid-cols-4">
        {items.map((k) => (
          <Card
            key={k.label}
            className="gap-3 rounded-none border-0 border-foreground/10 border-b ring-0 md:border-r md:border-b-0"
          >
            <CardHeader>
              <CardTitle className="font-normal text-muted-foreground text-sm">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <div className="text-2xl tabular-nums leading-none tracking-tight">{k.value}</div>
              <p className="text-muted-foreground text-xs">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
        <TrialCounter report={report} />
      </div>
    </div>
  );
}

function TrialCounter({ report }: { report: Report | null }) {
  const [reset, setReset] = useState(false);
  const trials = reset ? 0 : (report?.trials ?? 0);
  const limit = report?.trialLimit ?? 45;
  const share = trials / limit;
  return (
    <Card className="gap-3 rounded-none border-0 ring-0">
      <CardHeader>
        <CardTitle className="font-normal text-muted-foreground text-sm">Plans tested so far</CardTitle>
        <CardAction>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Reset trial counter"
            onClick={async () => {
              await fetch("/api/trials", { method: "DELETE" });
              setReset(true);
            }}
          >
            <RotateCcw />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div
          className={`text-2xl tabular-nums leading-none tracking-tight ${share > 1 ? "text-red-600" : share >= 0.8 ? "text-amber-500" : ""}`}
        >
          {trials} / {limit}
        </div>
        <Progress value={Math.min(100, share * 100)} />
        <p className="text-muted-foreground text-xs">
          {share >= 0.8
            ? "Near the limit: with this many tries, a good result is likely luck."
            : "Try enough plans and one looks great by luck. This counts them."}
        </p>
      </CardContent>
    </Card>
  );
}

function WhyPanel({ report }: { report: Report }) {
  const [q, setQ] = useState("Why did it get this verdict?");
  const [loading, setLoading] = useState(false);
  const [ans, setAns] = useState<{ answer: string; grounded: boolean; unmatched: string[] } | null>(null);
  async function ask() {
    setLoading(true);
    const r = await fetch("/api/why", { method: "POST", body: JSON.stringify({ runId: report.id, question: q }) }).then(
      (x) => x.json(),
    );
    setLoading(false);
    if (r.error) toast.error(r.error);
    else setAns(r);
  }
  return (
    <Card className="xl:col-span-5">
      <CardHeader>
        <CardTitle className="font-normal">Why?</CardTitle>
        <CardDescription>
          The answer is built from the Arize trace of this run, then checked against it.
        </CardDescription>
        {report.arizeUrl && (
          <CardAction>
            <Button asChild size="xs" variant="outline">
              <a href={report.arizeUrl} target="_blank" rel="noreferrer">
                Arize trace <ExternalLink />
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <InputGroup>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            aria-label="Question"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={ask} disabled={loading}>
              {loading ? <Spinner /> : "Ask"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {ans && (
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed">{ans.answer}</p>
            <Badge variant={ans.grounded ? "secondary" : "destructive"} className="w-fit">
              {ans.grounded ? "Every number matches the trace" : `Not in trace: ${ans.unmatched.join(", ")}`}
            </Badge>
          </div>
        )}
        <Trace>
          {report.steps.map((s) => (
            <TraceLine key={s.name} status={"error" in s.attrs ? "error" : undefined}>
              <TraceIcon>{s.kind === "LLM" ? "✦" : s.kind === "TOOL" ? "▣" : "✓"}</TraceIcon>
              <TraceTitle>{s.name}</TraceTitle>
              <TraceDescription>{(s.ms / 1000).toFixed(1)} s</TraceDescription>
            </TraceLine>
          ))}
          <TraceLine>
            <TraceTitle className="font-mono text-xs">trace {report.traceId.slice(0, 16)}…</TraceTitle>
          </TraceLine>
        </Trace>
      </CardContent>
    </Card>
  );
}

function CodePanel({ report }: { report: Report }) {
  const bad = new Set(report.suspectLines.map((l) => l.line));
  const leaked = report.reasons.some((r) => r.check === "peeking" && r.level === "fail");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the code box (not the page) to the first red line.
    const pre = box.current?.querySelector("pre");
    const line = box.current?.querySelector<HTMLElement>("[data-variant=removed]");
    if (leaked && pre && line) pre.scrollTop = line.offsetTop - pre.clientHeight / 2;
  }, [leaked]);
  return (
    <Card className="xl:col-span-7">
      <CardHeader>
        <CardTitle className="font-normal">Strategy code the agent wrote</CardTitle>
        <CardDescription>
          Ran as-is inside the sandbox.{" "}
          {leaked ? "Red lines read the future." : "Lines that look ahead would show in red."}
        </CardDescription>
      </CardHeader>
      <CardContent ref={box}>
        <CodeBlock size="sm" variant={leaked ? "destructive" : "default"}>
          <CodeBlockHeader>
            <CodeBlockTitle>strategy.py</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton value={report.code} />
            </CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent lineNumbers className="max-h-80">
            {report.code.split("\n").map((l, i) => (
              <CodeBlockLine key={i} variant={bad.has(i + 1) && leaked ? "removed" : "default"}>
                {l}
              </CodeBlockLine>
            ))}
          </CodeBlockContent>
        </CodeBlock>
      </CardContent>
    </Card>
  );
}

function FixIt({ report }: { report: Report }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Report[] | null>(null);
  async function fix() {
    setLoading(true);
    const r = await fetch("/api/fix", { method: "POST", body: JSON.stringify({ plan: report.plan }) }).then((x) =>
      x.json(),
    );
    setLoading(false);
    if (r.error) toast.error(r.error);
    else setRows(r.reports);
  }
  return (
    <Card className="xl:col-span-12">
      <CardHeader>
        <CardTitle className="font-normal">Fix it</CardTitle>
        <CardDescription>4 honest versions of your plan, tested at once. Each counts as a try.</CardDescription>
        <CardAction>
          <Button size="sm" onClick={fix} disabled={loading}>
            {loading ? <Spinner /> : <ShieldCheck />} Run 4 variants
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Build</TableHead>
                <TableHead className="text-right">Locked</TableHead>
                <TableHead className="text-right">Works on</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-56 truncate">{r.title}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.headline.build, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.headline.locked)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.table.filter((t) => (t.locked?.sharpe ?? 0) > 0).length}/30
                  </TableCell>
                  <TableCell className={GRADE_STYLE[r.grade].color}>{r.grade}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">
            Results show the real build and locked numbers, and the trial counter goes up by four.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SealCard({ report }: { report: Report }) {
  const [seal, setSeal] = useState<Seal | null>(null);
  const [loading, setLoading] = useState(false);
  async function doSeal() {
    setLoading(true);
    const r = await fetch("/api/seal", { method: "POST", body: JSON.stringify({ runId: report.id }) }).then((x) =>
      x.json(),
    );
    setLoading(false);
    if (r.error) toast.error(r.error);
    else setSeal(r);
  }
  const link = seal ? `${location.origin}/card/${seal.hash}` : "";
  return (
    <Card className="xl:col-span-7">
      <CardHeader>
        <CardTitle className="font-normal">Seal the verdict</CardTitle>
        <CardDescription>
          Dated and fingerprinted (SHA-256) so it can't be edited later. A 1-share paper trade tracks it from today.
        </CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={doSeal} disabled={loading || !!seal}>
            {loading ? <Spinner /> : <Stamp />} Seal
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {seal ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">SHA-256</span>
              <code className="break-all font-mono text-xs">{seal.hash}</code>
            </div>
            <div className="text-muted-foreground text-xs">Sealed {new Date(seal.sealedAt).toLocaleString()}</div>
            <div className="text-xs">
              Alpaca paper order:{" "}
              {seal.order ? (
                seal.order.error ? (
                  <span className="text-destructive">{seal.order.error}</span>
                ) : (
                  `1 ${report.ticker} · ${seal.order.status} · ${seal.order.id?.slice(0, 8)}`
                )
              ) : (
                <span className="text-muted-foreground">skipped (no Alpaca key)</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button asChild size="sm">
                <a href={link} target="_blank" rel="noreferrer">
                  Open shareable card <ExternalLink />
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}
              >
                Copy link
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">
            Nothing sealed yet. Press Seal to lock this verdict and get a share link.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SafetyPanel() {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <ul className="flex list-disc flex-col gap-2 pl-4 text-muted-foreground">
        <li>Strategy code runs in a Daytona sandbox with the network blocked.</li>
        <li>Alpaca, Daytona and model keys stay outside the sandbox. Prices go in as files.</li>
        <li>Paper money only. No real order is ever sent.</li>
        <li>The peeking check catches code that reads the future, not a model that remembers the past.</li>
        <li>Stock list is today's survivors. Prices are split and dividend adjusted.</li>
        <li>Thresholds for "collapse" and "very few" are provisional until tuned on real results.</li>
      </ul>
      <p className="font-medium">{DISCLAIMER}</p>
    </div>
  );
}

const STEPS = [
  { title: "Describe", detail: "Your plan in plain English" },
  { title: "Claude writes code", detail: "Turns it into a Python strategy" },
  { title: "30 stocks tested", detail: "In locked-down Daytona computers" },
  { title: "Verdict", detail: "Trust it or not, and why" },
];

/** The four-step flow, lit up as a run moves through it. */
function Steps({ step, done }: { step: number; done: boolean }) {
  return (
    <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {STEPS.map((x, i) => {
        const n = i + 1;
        const state = n < step || (done && n === step) ? "done" : n === step ? "active" : "todo";
        return (
          <li
            key={x.title}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${state === "active" ? "border-primary bg-primary/5" : state === "todo" ? "opacity-60" : ""}`}
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${state === "done" ? "bg-green-600 text-white" : state === "active" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {state === "done" ? <CircleCheck className="size-3.5" /> : n}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-sm">{x.title}</span>
              <span className="truncate text-muted-foreground text-xs">{x.detail}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
