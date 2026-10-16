import { why } from "@/server/paperdesk/run";

export async function POST(req: Request) {
  const { runId, question } = (await req.json()) as { runId?: string; question?: string };
  if (!runId) return Response.json({ error: "runId required" }, { status: 400 });
  try {
    return Response.json(await why(runId, (question || "Why did it get this verdict?").slice(0, 500)));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
