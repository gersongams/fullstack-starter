import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { after } from "next/server";
import { Pool } from "pg";

import { resetPasswordEmail, verificationEmail } from "./email-templates";
import { env } from "./env";
import { sendMail } from "./mailer";

// Must match MIN_PASSWORD_LENGTH in src/lib/password.ts.
const MIN_PASSWORD_LENGTH = 10;

// Runs work after the response is sent. Emails go out this way so the response
// time does not depend on whether a message was sent, which would tell a caller
// whether an address has an account. `after` only works inside a request; the
// Better Auth CLI and tests have none, so the promise is left to settle.
function runAfterResponse(promise: Promise<unknown>) {
  try {
    after(promise);
  } catch {
    void promise.catch(() => {});
  }
}

// Every verification link lands on /email-verified, whichever flow asked for it
// (sign-up, the resend button, a sign-in attempt) and whatever callbackURL the
// caller sent.
function verificationLink(url: string) {
  const link = new URL(url);
  link.searchParams.set("callbackURL", "/email-verified");
  return link.toString();
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Better Auth owns the "auth" schema; the Go API owns the rest of the database.
  database: new Pool({
    connectionString: env.DATABASE_URL,
    options: "-c search_path=auth",
    max: 10,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    // With this on, sign-up and sign-in give no session until the address is
    // confirmed, and signing up with a registered address answers like a new one.
    requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    sendResetPassword: async ({ user, url }) => {
      runAfterResponse(
        sendMail("password-reset", user.email, resetPasswordEmail({ name: user.name, url })),
      );
    },
    // A reset is what someone does after losing control of the account, so
    // every session that was open with the old password ends.
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      runAfterResponse(
        sendMail(
          "email-verification",
          user.email,
          verificationEmail({ name: user.name, url: verificationLink(url) }),
        ),
      );
    },
    sendOnSignUp: true,
    // An unverified sign-in attempt gets a fresh link instead of a dead end.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
  },
  // Spelled out rather than left to defaults. Better Auth also applies its own
  // stricter built-in rules on top of these: 3 requests per 10 seconds for
  // /sign-in, /sign-up, /change-password and /change-email, and 3 per 60 seconds
  // for /request-password-reset and /send-verification-email. Counters are in
  // memory, per instance; use `storage: "database"` or a secondary storage when
  // running several.
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    window: 10,
    max: 100,
  },
  advanced: {
    ipAddress: {
      // The rate limit is keyed on this address. x-forwarded-for is whatever the
      // caller sent unless a proxy in front overwrites it, so deployments name
      // the header their platform controls. See docs/authentication.md.
      ...(env.AUTH_IP_HEADER ? { ipAddressHeaders: [env.AUTH_IP_HEADER] } : {}),
      ...(env.AUTH_TRUSTED_PROXIES ? { trustedProxies: env.AUTH_TRUSTED_PROXIES } : {}),
    },
    backgroundTasks: { handler: runAfterResponse },
  },
  plugins: [
    // Short-lived tokens the Go API verifies through /api/auth/jwks.
    jwt({
      jwt: {
        issuer: env.BETTER_AUTH_URL,
        audience: env.API_JWT_AUDIENCE,
        expirationTime: "15m",
        definePayload: ({ user }) => ({ email: user.email, name: user.name }),
      },
    }),
    // Must stay last: it lets server-side auth calls set cookies.
    nextCookies(),
  ],
});
