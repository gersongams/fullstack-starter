import { ResendVerification } from "@/components/resend-verification";

/** Shown in the app shell while the signed-in user's address is unconfirmed. */
export function VerifyEmailBanner({ email }: { email: string }) {
  return (
    <section
      aria-label="Email verification"
      className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 rounded-md border border-dashed bg-muted/40 px-4 py-3"
    >
      <p className="max-w-prose text-sm">
        <span className="font-medium">Confirm your email address.</span>{" "}
        <span className="text-muted-foreground">
          We sent a link to {email}. Until you confirm it, a forgotten password cannot be reset
          safely.
        </span>
      </p>
      <ResendVerification email={email} variant="link" />
    </section>
  );
}
