import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  // Validated here rather than in proxy.ts: a stale cookie must not redirect.
  if (await getSession()) {
    redirect("/dashboard");
  }

  return <AuthForm mode="sign-up" />;
}
