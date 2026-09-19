import type { Metadata } from "next";
import Link from "next/link";

import { AuthPage, authLinkClass } from "@/components/auth-page";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The URL carries a one-time token: keep it out of Referer headers.
  referrer: "no-referrer",
};

// No session check and no redirect: the emailed link must work whether or not
// this browser is signed in, and the token, not a session, authorises the change.
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;

  if (typeof token !== "string" || token.length === 0 || error) {
    return (
      <AuthPage
        title="This link no longer works"
        description="Password reset links expire after one hour and can be used once."
      >
        <p className="text-sm">
          <Link href="/forgot-password" className={authLinkClass}>
            Request a new link
          </Link>
        </p>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Choose a new password"
      description="Saving it signs you out everywhere, so you will sign in again with the new password."
    >
      <ResetPasswordForm token={token} />
    </AuthPage>
  );
}
