"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { AuthPage, authLinkClass } from "@/components/auth-page";
import { ResendVerification } from "@/components/resend-verification";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { clearApiToken } from "@/lib/api/token";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD_LENGTH, newPassword } from "@/lib/password";

const REQUEST_FAILED = "Something went wrong. Try again.";

const email = z.email("Enter a valid email address");

const schemas = {
  "sign-in": z.object({
    name: z.string(),
    email,
    password: z.string().min(1, "Enter your password"),
  }),
  "sign-up": z.object({
    name: z.string().trim().min(1, "Enter your name"),
    email,
    password: newPassword,
  }),
};

type AuthValues = z.infer<(typeof schemas)["sign-up"]>;

const copy = {
  "sign-in": {
    title: "Sign in",
    submit: "Sign in",
    pending: "Signing in…",
    switchText: "New here?",
    switchLabel: "Create an account",
    switchHref: "/sign-up",
  },
  "sign-up": {
    title: "Create your account",
    submit: "Create account",
    pending: "Creating account…",
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/sign-in",
  },
} as const;

export function AuthForm({
  mode,
  next = "/dashboard",
  notice,
}: {
  mode: "sign-in" | "sign-up";
  /** Where to go once signed in. The page validates it with safeRedirectPath. */
  next?: Route;
  notice?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  // Set when the server wants the address confirmed before it gives a session.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string>();
  const text = copy[mode];

  const form = useForm<AuthValues>({
    resolver: zodResolver(schemas[mode]),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function submit(values: AuthValues) {
    setPending(true);
    setError(undefined);

    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email(values)
          : // No callbackURL here: on sign-in the client treats it as "navigate there
            // on success", which would override `next`.
            await authClient.signIn.email({ email: values.email, password: values.password });

      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setUnverifiedEmail(values.email);
        } else {
          setError(result.error.message ?? REQUEST_FAILED);
        }
        setPending(false);
        return;
      }

      // Verification is required: the account exists but there is no session yet.
      if (!result.data?.token) {
        setUnverifiedEmail(values.email);
        setPending(false);
        return;
      }

      // Nothing cached for a previous user may survive a new sign-in.
      clearApiToken();
      queryClient.clear();
      router.replace(next);
      router.refresh();
    } catch {
      // No `finally`: React Compiler skips components that use one, and
      // `pending` stays set on success until the navigation replaces this page.
      setError(REQUEST_FAILED);
      setPending(false);
    }
  }

  if (unverifiedEmail) {
    return (
      <AuthPage
        title="Check your inbox"
        description={`We sent a link to ${unverifiedEmail}. Open it to confirm your address, then sign in.`}
      >
        <div className="space-y-6">
          <ResendVerification email={unverifiedEmail} />
          <p className="text-sm text-muted-foreground">
            <Link href="/sign-in" className={authLinkClass}>
              Back to sign in
            </Link>
          </p>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage title={text.title}>
      {notice && (
        <output className="mb-6 block rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {notice}
        </output>
      )}

      <form onSubmit={form.handleSubmit(submit)} noValidate>
        <FieldGroup>
          {mode === "sign-up" && (
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="name">Full name</FieldLabel>
                  <Input
                    {...field}
                    id="name"
                    autoComplete="name"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          )}

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

          <Controller
            name="password"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <div className="flex items-baseline justify-between gap-4">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  {mode === "sign-in" && (
                    <Link
                      href="/forgot-password"
                      className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  {...field}
                  id="password"
                  type="password"
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={
                    mode === "sign-up" && !fieldState.invalid ? "password-hint" : undefined
                  }
                />
                {mode === "sign-up" && !fieldState.invalid && (
                  <FieldDescription id="password-hint">
                    At least {MIN_PASSWORD_LENGTH} characters.
                  </FieldDescription>
                )}
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
            {pending ? text.pending : text.submit}
          </Button>
        </FieldGroup>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        {text.switchText}{" "}
        <Link href={text.switchHref} className={authLinkClass}>
          {text.switchLabel}
        </Link>
      </p>
    </AuthPage>
  );
}
