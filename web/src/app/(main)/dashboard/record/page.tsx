import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStore } from "@/server/paperdesk/run";

export const dynamic = "force-dynamic";

export default function Page() {
  const seals = getStore().seals;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl tracking-tight">Sealed record</h1>
        <p className="text-muted-foreground text-sm">Every sealed verdict, dated and hashed. Later we grade whether each one held up on live paper results.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="font-normal">{seals.length} sealed verdicts</CardTitle>
          <CardDescription>Nobody can edit these afterwards: the hash covers the plan, code, verdict and date.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sealed</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>Held up?</TableHead>
                <TableHead>Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seals.map((s) => (
                <TableRow key={s.hash}>
                  <TableCell className="whitespace-nowrap">{new Date(s.sealedAt).toLocaleString()}</TableCell>
                  <TableCell className="max-w-80 truncate">{s.plan}</TableCell>
                  <TableCell>{s.ticker}</TableCell>
                  <TableCell>
                    <Badge variant={s.grade === "Do not trust" ? "destructive" : s.grade === "Trust" ? "default" : "secondary"}>{s.grade}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">pending</TableCell>
                  <TableCell>
                    <Link className="font-mono text-xs underline-offset-4 hover:underline" href={`/card/${s.hash}`}>
                      {s.hash.slice(0, 12)}…
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
