import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { safeRedirectPath } from "@/lib/redirect";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  // `next` is attacker-controlled: only a same-origin path that is not an auth
  // page survives, so it can be neither an open redirect nor a loop.
  const next = safeRedirectPath(params.next);

  // Validated here rather than in proxy.ts: a stale cookie must not redirect.
  if (await getSession()) {
    redirect(next);
  }

  return (
    <AuthForm
      mode="sign-in"
      next={next}
      notice={params.reset === "done" ? "Password changed. Sign in with the new one." : undefined}
    />
  );
}
