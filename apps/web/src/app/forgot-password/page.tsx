import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthPage } from "@/components/auth-page";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  // Validated here rather than in proxy.ts: a stale cookie must not redirect.
  if (await getSession()) {
    redirect("/dashboard");
  }

  return (
    <AuthPage
      title="Forgot your password?"
      description="Enter the email of your account and we will send a link to choose a new one."
    >
      <ForgotPasswordForm />
    </AuthPage>
  );
}
