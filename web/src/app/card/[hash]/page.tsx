import { notFound } from "next/navigation";

import { getStore } from "@/server/paperdesk/run";

export const dynamic = "force-dynamic";

const COLOR = { Trust: "text-green-600", "Be careful": "text-amber-500", "Do not trust": "text-red-600" } as Record<string, string>;

/** Public shareable verdict card. */
export default async function Page({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const s = getStore().seals.find((x) => x.hash === hash);
  if (!s) notFound();
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-4">
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-2xl bg-card p-8 shadow-sm ring-1 ring-foreground/10">
        <div className="text-muted-foreground text-xs uppercase tracking-widest">Paper Desk · second opinion</div>
        <div className="line-clamp-3 text-lg">{s.plan.includes("def strategy(") ? `${s.title} · ${s.ticker}` : s.plan}</div>
        <div className={`font-semibold text-4xl ${COLOR[s.grade]}`}>{s.grade}</div>
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm">
          {s.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 border-t pt-4 text-muted-foreground text-xs">
          <span>Sealed {new Date(s.sealedAt).toUTCString()}</span>
          <code className="break-all font-mono">sha256 {s.hash}</code>
          <span>Practice only. Not financial advice. Past results do not predict future results.</span>
        </div>
      </div>
    </main>
  );
}
