import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell";
import { requireSession } from "@/lib/session";

import { MeCard } from "./me-card";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // The real check. proxy.ts only looks for a cookie; this validates the session.
  const session = await requireSession();

  return (
    <>
      <PageHeader title={`Welcome, ${session.user.name}`} />
      <MeCard />
    </>
  );
}
