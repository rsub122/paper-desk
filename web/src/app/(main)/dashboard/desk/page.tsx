import type { Metadata } from "next";

import { Desk } from "./_components/desk";

export const metadata: Metadata = { title: "Desk · Paper Desk" };

export default function Page() {
  return <Desk />;
}
