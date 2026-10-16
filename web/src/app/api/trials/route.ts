import { getStore, resetTrials } from "@/server/paperdesk/run";

export async function GET() {
  return Response.json({ trials: getStore().trials });
}

export async function DELETE() {
  resetTrials();
  return Response.json({ trials: 0 });
}
