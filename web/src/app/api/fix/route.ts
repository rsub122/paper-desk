import { runVariants } from "@/server/paperdesk/run";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { plan } = (await req.json()) as { plan?: string };
  if (!plan?.trim()) return Response.json({ error: "plan required" }, { status: 400 });
  try {
    return Response.json({ reports: await runVariants(plan) });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
