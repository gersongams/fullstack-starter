import { createServer } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RECIPIENT = "ada.lovelace@example.com";
const LINK = "https://app.example.com/reset-password?token=s3cr3t-reset-token";
const CONTENT = {
  subject: "Reset your password",
  text: `Open ${LINK} to choose a new password.`,
  html: `<a href="${LINK}">Reset</a>`,
};

const LOG_METHODS = ["log", "info", "warn", "error", "debug"] as const;

/** Everything written to the console, joined, so one assertion covers every method. */
function captureConsole() {
  const spies = LOG_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  return () => spies.flatMap((spy) => spy.mock.calls.map((call) => call.join(" "))).join("\n");
}

function expectNothingSensitive(logged: string) {
  for (const secret of [RECIPIENT, "ada.lovelace", LINK, "s3cr3t-reset-token", CONTENT.subject]) {
    expect(logged).not.toContain(secret);
  }
}

/** A fresh mailer, with nodemailer replaced by a transport that fails with `failure`. */
async function mailerFailingWith(failure: unknown) {
  vi.resetModules();
  const send = vi.fn().mockRejectedValue(failure);
  vi.doMock("nodemailer", () => ({ createTransport: () => ({ sendMail: send }) }));
  const { sendMail } = await import("./mailer");
  return { sendMail, send };
}

/** A local port with nothing listening on it. */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/db");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3100");
  vi.stubEnv("SMTP_URL", "smtp://localhost:1025");
  vi.stubEnv("MAIL_FROM", "Fullstack Starter <no-reply@example.com>");
  vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "");
  vi.stubEnv("AUTH_IP_HEADER", "");
  vi.stubEnv("AUTH_TRUSTED_PROXIES", "");
});

afterEach(() => {
  vi.doUnmock("nodemailer");
  vi.unstubAllEnvs();
});

describe("sendMail when SMTP fails", () => {
  it("does not throw when the server is unreachable, and logs only the kind and the code", async () => {
    const logged = captureConsole();
    // nodemailer's own messages quote addresses, which is why only the code is logged.
    const failure = Object.assign(new Error(`connect ECONNREFUSED while sending to ${RECIPIENT}`), {
      code: "ECONNREFUSED",
    });
    const { sendMail, send } = await mailerFailingWith(failure);

    await expect(sendMail("password-reset", RECIPIENT, CONTENT)).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledOnce();
    expect(logged()).toBe("mail failed kind=password-reset code=ECONNREFUSED");
    expectNothingSensitive(logged());
  });

  it("does not throw when the server rejects the recipient", async () => {
    const logged = captureConsole();
    const failure = Object.assign(new Error(`Can't send mail - all recipients were rejected`), {
      code: "EENVELOPE",
      response: `550 5.1.1 <${RECIPIENT}>: Recipient address rejected`,
      rejected: [RECIPIENT],
    });
    const { sendMail } = await mailerFailingWith(failure);

    await expect(sendMail("email-verification", RECIPIENT, CONTENT)).resolves.toBeUndefined();

    expect(logged()).toBe("mail failed kind=email-verification code=EENVELOPE");
    expectNothingSensitive(logged());
  });

  it("copes with a failure that is not an Error", async () => {
    const logged = captureConsole();
    const { sendMail } = await mailerFailingWith(`could not deliver to ${RECIPIENT}`);

    await expect(sendMail("password-reset", RECIPIENT, CONTENT)).resolves.toBeUndefined();

    expect(logged()).toBe("mail failed kind=password-reset code=unknown");
  });

  it("logs nothing at all when the message is sent", async () => {
    const logged = captureConsole();
    vi.resetModules();
    const send = vi.fn().mockResolvedValue({ messageId: "<1@example.com>" });
    vi.doMock("nodemailer", () => ({ createTransport: () => ({ sendMail: send }) }));
    const { sendMail } = await import("./mailer");

    await sendMail("password-reset", RECIPIENT, CONTENT);

    expect(send).toHaveBeenCalledWith({
      from: "Fullstack Starter <no-reply@example.com>",
      to: RECIPIENT,
      ...CONTENT,
    });
    expect(logged()).toBe("");
  });

  it("does not throw against a real closed port", async () => {
    const logged = captureConsole();
    vi.stubEnv("SMTP_URL", `smtp://127.0.0.1:${await closedPort()}`);
    vi.resetModules();
    vi.doUnmock("nodemailer");
    const { sendMail } = await import("./mailer");

    await expect(sendMail("password-reset", RECIPIENT, CONTENT)).resolves.toBeUndefined();

    expect(logged()).toMatch(/^mail failed kind=password-reset code=E[A-Z]+$/);
    expectNothingSensitive(logged());
  });
});

// The forgot-password page shows the same confirmation whatever happens. What
// can differ on the server is whether Better Auth's handler waits for, or fails
// with, the SMTP call; these tests pin that it does neither.
describe("the password-reset and verification hooks in auth.ts", () => {
  const user = { id: "u1", name: "Ada", email: RECIPIENT, emailVerified: false };

  async function hooksWith(send: ReturnType<typeof vi.fn>) {
    vi.resetModules();
    vi.doMock("nodemailer", () => ({ createTransport: () => ({ sendMail: send }) }));
    const { auth } = await import("./auth");
    const sendReset = auth.options.emailAndPassword.sendResetPassword;
    const sendVerification = auth.options.emailVerification.sendVerificationEmail;
    return {
      reset: () => sendReset({ user, url: LINK, token: "t" } as never),
      verification: () => sendVerification({ user, url: LINK, token: "t" } as never),
    };
  }

  /** Calls both hooks while the SMTP call is still in flight, then lets it settle. */
  async function outcomesWhenSendWill(settle: "resolve" | "reject") {
    const send = Promise.withResolvers<void>();
    const hooks = await hooksWith(vi.fn().mockReturnValue(send.promise));

    const outcomes = [await hooks.reset(), await hooks.verification()];

    if (settle === "resolve") {
      send.resolve();
    } else {
      send.reject(Object.assign(new Error(`rejected ${RECIPIENT}`), { code: "ECONNREFUSED" }));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return outcomes;
  }

  it("answer the same way, and without waiting, whether the send succeeds or fails", async () => {
    const logged = captureConsole();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const sent = await outcomesWhenSendWill("resolve");
    const failed = await outcomesWhenSendWill("reject");

    process.off("unhandledRejection", unhandled);
    expect(sent).toEqual([undefined, undefined]);
    expect(failed).toEqual(sent);
    expect(unhandled).not.toHaveBeenCalled();
    expectNothingSensitive(logged());
  });
});
