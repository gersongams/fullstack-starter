import { AppShell } from "@/components/app-shell";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // For the shell's user menu. This is not the access check: a layout is not
  // re-rendered on client navigation, so every page calls requireSession itself.
  const session = await requireSession();

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      banner={
        session.user.emailVerified ? undefined : <VerifyEmailBanner email={session.user.email} />
      }
    >
      {children}
    </AppShell>
  );
}
