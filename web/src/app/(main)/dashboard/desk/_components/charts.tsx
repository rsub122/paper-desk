"use client";

import { useEffect, useRef } from "react";

import { CandlestickSeries, ColorType, createChart, createSeriesMarkers } from "lightweight-charts";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";

import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { Report } from "@/server/paperdesk/run";

const UP = "#16a34a";
const DOWN = "#dc2626";
export const pct = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}%`;

/** lightweight-charts only parses rgb/hex; the theme uses oklch. Let the browser convert via a 1px canvas. */
function cssColor(name: string) {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
}

/** Candles for the named stock with the strategy's buys and sells, and the locked period marked. */
export function PriceChart({ report }: { report: Report }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const f = report.focus;
    if (!el || !f?.bars) return;
    const fg = cssColor("--muted-foreground");
    const grid = cssColor("--border");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: fg, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
    });
    series.setData(f.bars);
    // ponytail: markers capped to the last 60 trades; a leaky strategy trades almost daily and floods the chart.
    createSeriesMarkers(
      series,
      [
        ...(f.trades ?? []).slice(-60).map((t) => ({
          time: t.time,
          position: t.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
          color: t.side === "buy" ? UP : DOWN,
          shape: t.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
        })),
        { time: report.lockDate, position: "aboveBar" as const, color: "#7c3aed", shape: "square" as const, text: "Locked period →" },
      ].sort((a, b) => a.time.localeCompare(b.time)),
    );
    const from = new Date(report.lockDate);
    from.setMonth(from.getMonth() - 9);
    chart.timeScale().setVisibleRange({ from: from.toISOString().slice(0, 10), to: f.bars.at(-1)!.time });
    return () => chart.remove();
  }, [report]);
  return <div ref={ref} className="h-72 w-full" />;
}

const equityConfig = {
  s: { label: "Strategy", color: "var(--primary)" },
  b: { label: "Buy and hold", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** Growth of $1, log scale so a leaky +1,000,000% and an honest +50% fit on one chart. */
export function EquityChart({ report }: { report: Report }) {
  const data = report.focus?.curve ?? [];
  const end = data.at(-1)?.d;
  const lockX = data.find((p) => p.d >= report.lockDate)?.d; // categorical axis: snap to a real point
  return (
    <ChartContainer config={equityConfig} className="h-64 w-full">
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="d" tickLine={false} axisLine={false} minTickGap={48} tickFormatter={(d: string) => d.slice(0, 4)} tick={{ fontSize: 11 }} />
        <YAxis scale="log" domain={["auto", "auto"]} allowDataOverflow tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v >= 100 ? v.toExponential(0) : v.toFixed(1)}`} />
        {end && lockX && <ReferenceArea x1={lockX} x2={end} fill="#7c3aed" fillOpacity={0.08} label={{ value: "locked", position: "insideTop", fontSize: 11 }} />}
        <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, n) => `${equityConfig[n as "s" | "b"].label}: $${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`} />} />
        <Line dataKey="b" stroke="var(--color-b)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Line dataKey="s" stroke="var(--color-s)" dot={false} strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}

const breadthConfig = { sharpe: { label: "Locked Sharpe", color: "var(--primary)" } } satisfies ChartConfig;

/** Same rule on 30 stocks: locked-period Sharpe per stock. */
export function BreadthChart({ report }: { report: Report }) {
  const data = report.table
    .filter((r) => r.locked && "sharpe" in r.locked)
    .map((r) => ({ t: r.ticker, sharpe: Number(r.locked!.sharpe.toFixed(2)) }))
    .sort((a, b) => b.sharpe - a.sharpe);
  return (
    <ChartContainer config={breadthConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="t" tickLine={false} axisLine={false} interval={0} angle={-60} textAnchor="end" height={40} tick={{ fontSize: 10 }} />
        <YAxis tickLine={false} axisLine={false} width={32} tick={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="sharpe" radius={3} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.t} fill={d.sharpe > 0 ? UP : DOWN} fillOpacity={d.t === report.ticker ? 1 : 0.55} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
