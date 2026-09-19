import type { Metadata } from "next";

import { requireSession } from "@/lib/session";

import { ClientsView } from "./clients-view";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  // The real check. proxy.ts only looks for a cookie; this validates the session.
  await requireSession();

  return <ClientsView />;
}
