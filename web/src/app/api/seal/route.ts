import { getStore, seal } from "@/server/paperdesk/run";

export async function GET() {
  return Response.json(getStore().seals);
}

export async function POST(req: Request) {
  const { runId } = (await req.json()) as { runId?: string };
  if (!runId) return Response.json({ error: "runId required" }, { status: 400 });
  try {
    return Response.json(await seal(runId));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
