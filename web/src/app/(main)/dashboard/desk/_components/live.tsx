"use client";

import { useEffect, useState } from "react";

import { Activity, Bot, Check, Container, ExternalLink, Gavel, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Report } from "@/server/paperdesk/run";

export type Box = {
  id: string;
  tickers: string[];
  status: "starting" | "running" | "done" | "error";
  sandboxId?: string;
  startedAt: number;
  endedAt?: number;
  lines: string[];
};
export type TickerState = { status: "done" | "error"; leak?: boolean; locked?: number };
export type Marks = { start: number; strategy?: number; report?: number };

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Re-render on a short interval while something is live: drives timers and the line-by-line terminal reveal. */
function useTick(on: boolean, ms = 60) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return n;
}

export function LiveRun({
  boxes,
  tickers,
  marks,
  running,
  report,
}: {
  boxes: Record<string, Box>;
  tickers: Record<string, TickerState>;
  marks: Marks | null;
  running: boolean;
  report: Report | null;
}) {
  const list = Object.values(boxes).sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
  const pending = list.some((b) => b.status === "starting" || b.status === "running");
  // ponytail: reveal streamed lines a few per tick so a 1-second burst is readable on stage. All lines are real.
  const [shown, setShown] = useState<Record<string, number>>({});
  const behind = list.some((b) => (shown[b.id] ?? 0) < b.lines.length);
  const tick = useTick(running || behind);
  useEffect(() => {
    setShown((s) => {
      const next = { ...s };
      for (const b of list) next[b.id] = Math.min(b.lines.length, (s[b.id] ?? 0) + 1);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  useEffect(() => {
    if (!marks) setShown({});
  }, [marks]);

  const up = list.filter((b) => b.sandboxId).length;
  const finished = list.filter((b) => b.status === "done" || b.status === "error").length;
  const sandboxesEnd = list.length && !pending ? Math.max(...list.map((b) => b.endedAt ?? 0)) : undefined;
  const now = Date.now();

  type Stage = {
    key: string;
    icon: typeof Bot;
    title: string;
    detail: string;
    state: "idle" | "active" | "done" | "error";
    ms?: number;
  };
  const stages: Stage[] = [
    {
      key: "agent",
      icon: Bot,
      title: "Claude agent",
      detail: marks?.strategy ? "Wrote strategy.py" : marks ? "Turning your plan into code…" : "Plan → Python",
      state: !marks ? "idle" : marks.strategy ? "done" : "active",
      ms: marks ? (marks.strategy ?? now) - marks.start : undefined,
    },
    {
      key: "daytona",
      icon: Container,
      title: `${list.length || 10} Daytona sandboxes`,
      detail: !list.length
        ? "Network blocked · no keys"
        : pending
          ? `${up} up · ${finished} finished`
          : `${finished} finished · ${report?.mode ?? "daytona"}`,
      state: !list.length ? "idle" : pending ? "active" : list.some((b) => b.status === "error") ? "error" : "done",
      ms: marks?.strategy && list.length ? (sandboxesEnd ?? now) - marks.strategy : undefined,
    },
    {
      key: "referee",
      icon: Gavel,
      title: "Referee",
      detail: report ? report.grade : sandboxesEnd ? "Grading…" : "Peeking · locked period · breadth · trials",
      state: report ? "done" : sandboxesEnd && running ? "active" : "idle",
      ms: sandboxesEnd ? (marks?.report ?? now) - sandboxesEnd : undefined,
    },
    {
      key: "arize",
      icon: Activity,
      title: "Arize trace",
      detail: report ? `trace ${report.traceId.slice(0, 8)} · ${report.steps.length} spans` : "Every step recorded",
      state: report ? "done" : marks ? "active" : "idle",
    },
  ];

  return (
    <Card className="xl:col-span-12">
      <CardHeader>
        <CardTitle className="font-normal">Live run</CardTitle>
        <CardDescription>
          {marks
            ? `${sec((marks.report ?? now) - marks.start)} elapsed`
            : "Idle. Press Test my plan to start."}
        </CardDescription>
        <CardAction>
          <Button asChild size="xs" variant="outline">
            <a href="https://app.daytona.io/dashboard/sandboxes" target="_blank" rel="noreferrer">
              Daytona dashboard <ExternalLink />
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
          {stages.map((s, i) => (
            <li
              key={s.key}
              className={`relative flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                s.state === "active"
                  ? "border-primary/60 bg-primary/5"
                  : s.state === "done"
                    ? "border-green-600/40"
                    : s.state === "error"
                      ? "border-destructive/60"
                      : "border-dashed opacity-60"
              }`}
            >
              <span
                className={`relative grid size-9 shrink-0 place-items-center rounded-md ${s.state === "active" ? "bg-primary text-primary-foreground" : s.state === "done" ? "bg-green-600 text-white" : s.state === "error" ? "bg-destructive text-white" : "bg-muted"}`}
              >
                {s.state === "active" && <span className="absolute inset-0 animate-ping rounded-md bg-primary/40" />}
                {s.state === "done" ? (
                  <Check className="size-4" />
                ) : s.state === "error" ? (
                  <X className="size-4" />
                ) : (
                  <s.icon className="size-4" />
                )}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-[10px] uppercase tracking-wide">Step {i + 1}</span>
                <span className="truncate font-medium text-sm">{s.title}</span>
                <span className="truncate text-muted-foreground text-xs">{s.detail}</span>
              </div>
              {s.ms !== undefined && (
                <span className="ml-auto text-muted-foreground text-xs tabular-nums">{sec(s.ms)}</span>
              )}
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {(list.length
            ? list
            : Array.from(
                { length: 10 },
                (_, i) => ({ id: `sbx-${i + 1}`, tickers: [], status: "starting", startedAt: 0, lines: [] }) as Box,
              )
          ).map((b) => (
            <Terminal key={b.id} box={b} shown={shown[b.id] ?? 0} tickers={tickers} idle={!list.length} now={now} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Terminal({
  box,
  shown,
  tickers,
  idle,
  now,
}: {
  box: Box;
  shown: number;
  tickers: Record<string, TickerState>;
  idle: boolean;
  now: number;
}) {
  const live = !idle && (box.status === "starting" || box.status === "running");
  const lines = box.lines.slice(0, shown).slice(-6);
  const dot = idle
    ? "bg-zinc-600"
    : box.status === "error"
      ? "bg-red-500"
      : box.status === "done"
        ? "bg-green-500"
        : box.status === "running"
          ? "bg-sky-400 animate-pulse"
          : "bg-amber-400 animate-pulse";
  return (
    <div
      className={`flex h-48 flex-col overflow-hidden rounded-lg border bg-zinc-950 font-mono text-[10.5px] text-zinc-300 shadow-sm transition-shadow ${live ? "border-sky-500/50 shadow-sky-500/20" : "border-zinc-800"}`}
    >
      <div className="flex items-center gap-1.5 border-zinc-800 border-b bg-zinc-900 px-2 py-1">
        <span className={`size-2 rounded-full ${dot}`} />
        <span className="text-zinc-100">{box.id}</span>
        <span className="truncate text-zinc-500">
          {box.sandboxId ? box.sandboxId.slice(0, 8) : idle ? "idle" : "creating…"}
        </span>
        <span className="ml-auto text-zinc-500 tabular-nums">
          {!idle && box.startedAt ? sec((box.endedAt ?? now) - box.startedAt) : ""}
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-0.5 px-2 py-1.5">
        {idle && <span className="text-zinc-600">$ waiting for a plan_</span>}
        {lines.map((l, i) => (
          <span
            key={`${box.lines.length}-${i}`}
            className={`truncate ${/LEAK|crashed/.test(l) ? "text-red-400" : /clean/.test(l) ? "text-green-400" : /^sandbox /.test(l) ? "text-sky-300" : ""}`}
            title={l}
          >
            <span className="text-zinc-600">$ </span>
            {l}
            {live && i === lines.length - 1 && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-zinc-300 align-middle" />
            )}
          </span>
        ))}
        {!idle && !lines.length && <span className="text-amber-300/80">booting sandbox…</span>}
      </div>
      <div className="flex flex-wrap gap-1 border-zinc-800 border-t px-2 py-1.5">
        {box.tickers.map((t) => {
          const s = tickers[t];
          return (
            <Badge
              key={t}
              variant="outline"
              className={`h-4 rounded px-1 font-mono text-[9px] ${!s ? "border-zinc-700 text-zinc-500" : s.status === "error" ? "border-red-500 text-red-400" : s.leak ? "border-red-500 bg-red-500/20 text-red-300" : (s.locked ?? 0) > 0 ? "border-green-500/60 text-green-400" : "border-zinc-500 text-zinc-300"}`}
            >
              {t}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
