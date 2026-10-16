import { runPlan } from "@/server/paperdesk/run";

export const maxDuration = 300;

/** Terminal endpoint: curl -s localhost:3000/api/verdict -d '{"plan":"..."}' */
export async function POST(req: Request) {
  const { plan, injectBug } = (await req.json()) as { plan?: string; injectBug?: boolean };
  if (!plan?.trim() || plan.length > 2000) return Response.json({ error: "plan required (max 2000 chars)" }, { status: 400 });
  try {
    const r = await runPlan(plan, !!injectBug);
    return Response.json({
      verdict: r.grade,
      reasons: r.reasons.map((x) => x.text),
      ticker: r.ticker,
      build_return: r.headline.build,
      locked_return: r.headline.locked,
      trials: `${r.trials}/${r.trialLimit}`,
      run_id: r.id,
      trace_id: r.traceId,
      seconds: r.totalMs / 1000,
      disclaimer: "Practice only. Not financial advice. Past results do not predict future results.",
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
