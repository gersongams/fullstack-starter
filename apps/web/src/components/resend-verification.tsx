"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const FAILED = "We could not send the email. Wait a minute and try again.";

/**
 * Asks for another verification email. The answer is the same whether or not
 * the address has an account, so this never confirms that one exists.
 */
export function ResendVerification({
  email,
  variant = "outline",
}: {
  email: string;
  variant?: "outline" | "link";
}) {
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string>();

  async function resend() {
    setState("pending");
    setError(undefined);
    try {
      // The server decides where the link lands (verificationLink in lib/auth.ts).
      const result = await authClient.sendVerificationEmail({ email });
      if (result.error) {
        setError(FAILED);
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      // No `finally`: React Compiler skips components that use one.
      setError(FAILED);
      setState("idle");
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        size={variant === "link" ? "sm" : "default"}
        className={variant === "link" ? "h-auto p-0" : undefined}
        disabled={state !== "idle"}
        onClick={resend}
      >
        {state === "pending"
          ? "Sending…"
          : state === "sent"
            ? "Email sent"
            : "Send the email again"}
      </Button>
      {state === "sent" && (
        <output className="block text-sm text-muted-foreground">A new link is on its way.</output>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
