"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { authLinkClass } from "@/components/auth-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH, resetPasswordSchema, type ResetPasswordValues } from "@/lib/password";

const FAILED = "Something went wrong. Try again.";
const EXPIRED = "This link has expired or was already used.";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; expired: boolean }>();
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  async function submit(values: ResetPasswordValues) {
    setPending(true);
    setError(undefined);
    try {
      const result = await authClient.resetPassword({ newPassword: values.password, token });
      if (result.error) {
        const expired = result.error.code === "INVALID_TOKEN";
        setError({ message: expired ? EXPIRED : (result.error.message ?? FAILED), expired });
        setPending(false);
        return;
      }
      // Every session of the account was just revoked, so sign in again.
      router.replace("/sign-in?reset=done");
    } catch {
      // No `finally`: React Compiler skips components that use one, and
      // `pending` stays set on success until the navigation replaces this page.
      setError({ message: FAILED, expired: false });
      setPending(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <FieldGroup>
        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="password">New password</FieldLabel>
              <Input
                {...field}
                id="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? undefined : "password-hint"}
              />
              {!fieldState.invalid && (
                <FieldDescription id="password-hint">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </FieldDescription>
              )}
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="confirm"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="confirm">Repeat the new password</FieldLabel>
              <Input
                {...field}
                id="confirm"
                type="password"
                autoComplete="new-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error.message}{" "}
              {error.expired && (
                <Link href="/forgot-password" className={authLinkClass}>
                  Request a new link
                </Link>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save new password"}
        </Button>
      </FieldGroup>
    </form>
  );
}
