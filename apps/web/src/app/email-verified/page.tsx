import type { Metadata } from "next";
import Link from "next/link";

import { AuthPage, authLinkClass } from "@/components/auth-page";
import { ResendVerification } from "@/components/resend-verification";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Email verification" };

// Where the emailed link lands, after /api/auth/verify-email has checked the
// token. It redirects nowhere: it only reports the outcome, so it cannot take
// part in a redirect loop whatever the state of the session.
export default async function EmailVerifiedPage({ searchParams }: PageProps<"/email-verified">) {
  const [{ error }, session] = await Promise.all([searchParams, getSession()]);

  if (error) {
    const unverified = session && !session.user.emailVerified ? session.user.email : undefined;
    return (
      <AuthPage
        title="This link no longer works"
        description="Verification links expire after one hour."
      >
        {unverified ? (
          <ResendVerification email={unverified} />
        ) : (
          <p className="text-sm">
            <Link href="/sign-in" className={authLinkClass}>
              Sign in
            </Link>{" "}
            <span className="text-muted-foreground">to request a new one.</span>
          </p>
        )}
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Email confirmed" description="Thank you. Your address is verified.">
      <p className="text-sm">
        <Link href={session ? "/dashboard" : "/sign-in"} className={authLinkClass}>
          {session ? "Continue to the dashboard" : "Sign in"}
        </Link>
      </p>
    </AuthPage>
  );
}
