// Server only. Sends mail through any SMTP server (SMTP_URL): Mailpit in
// development, the provider of your choice in production.

import { createTransport } from "nodemailer";

import type { EmailContent } from "./email-templates";
import { env } from "./env";

export type MailKind = "email-verification" | "password-reset";

// Created on first use, so importing this module (the Better Auth CLI does,
// through auth.ts) opens no connection.
let transport: ReturnType<typeof createTransport> | undefined;

function getTransport() {
  transport ??= createTransport(env.SMTP_URL);
  return transport;
}

/**
 * Sends one message and never throws: callers run it after the response, and a
 * failure must not change what the requester sees (that would reveal whether
 * the address has an account). Only failures are logged, with the kind of
 * message and the error code: never the recipient, the link or the body.
 */
export async function sendMail(kind: MailKind, to: string, content: EmailContent) {
  try {
    await getTransport().sendMail({ from: env.MAIL_FROM, to, ...content });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unknown";
    // The error message can quote the recipient, so only its code is logged.
    console.error(`mail failed kind=${kind} code=${code}`);
  }
}
