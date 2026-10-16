import { runPlan } from "@/server/paperdesk/run";

export const maxDuration = 300;

/** UI endpoint: streams NDJSON events (strategy, sandbox, ticker) and ends with {type:"report"}. */
export async function POST(req: Request) {
  const { plan, injectBug } = (await req.json()) as { plan?: string; injectBug?: boolean };
  if (!plan?.trim() || plan.length > 2000) return Response.json({ error: "plan required (max 2000 chars)" }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (o: unknown) => c.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      try {
        send({ type: "report", report: await runPlan(plan, !!injectBug, send) });
      } catch (e) {
        send({ type: "error", error: String(e) });
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
