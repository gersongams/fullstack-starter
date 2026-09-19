"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { authLinkClass } from "@/components/auth-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const schema = z.object({ email: z.email("Enter a valid email address") });
type Values = z.infer<typeof schema>;

const FAILED = "We could not process the request. Wait a minute and try again.";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  async function submit(values: Values) {
    setPending(true);
    setError(undefined);
    try {
      const result = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        // Only transport problems and the rate limit end up here. An unknown
        // address is answered exactly like a known one.
        setError(FAILED);
        setPending(false);
        return;
      }
      setSent(true);
    } catch {
      // No `finally`: React Compiler skips components that use one.
      setError(FAILED);
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-6">
        <output className="block text-sm">
          If an account exists for that address, a link to choose a new password is on its way. It
          expires in one hour.
        </output>
        <p className="text-sm text-muted-foreground">
          <Link href="/sign-in" className={authLinkClass}>
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={form.handleSubmit(submit)} noValidate>
        <FieldGroup>
          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  {...field}
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </FieldGroup>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/sign-in" className={authLinkClass}>
          Back to sign in
        </Link>
      </p>
    </>
  );
}
