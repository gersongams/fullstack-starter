import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts reads process.env when it is first imported, so every test imports a
// fresh copy after setting up the environment.
async function loadEnv() {
  vi.resetModules();
  return (await import("./env")).env;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/db");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3100");
  vi.stubEnv("API_JWT_AUDIENCE", "");
  vi.stubEnv("SMTP_URL", "smtp://localhost:1025");
  vi.stubEnv("MAIL_FROM", "Fullstack Starter <no-reply@example.com>");
  vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "");
  vi.stubEnv("AUTH_IP_HEADER", "");
  vi.stubEnv("AUTH_TRUSTED_PROXIES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env", () => {
  it("defaults the token audience to the one the Go API expects", async () => {
    expect((await loadEnv()).API_JWT_AUDIENCE).toBe("starter-api");
  });

  it("strips the trailing slash from the public URL, which is also the token issuer", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com/");
    expect((await loadEnv()).BETTER_AUTH_URL).toBe("https://app.example.com");
  });

  it("names the missing variable", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    await expect(loadEnv()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects a public URL that is not a URL", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "not a url");
    await expect(loadEnv()).rejects.toThrow(/BETTER_AUTH_URL must be an http\(s\) URL/);
  });

  it("rejects a public URL without a scheme, which URL.canParse would accept", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "localhost:3100");
    await expect(loadEnv()).rejects.toThrow(/BETTER_AUTH_URL must be an http\(s\) URL/);
  });

  it("accepts smtp and smtps URLs, with credentials", async () => {
    vi.stubEnv("SMTP_URL", "smtps://user:pass@smtp.example.com:465");
    expect((await loadEnv()).SMTP_URL).toBe("smtps://user:pass@smtp.example.com:465");
  });

  it("rejects an SMTP URL with another scheme without echoing it, since it may hold a password", async () => {
    vi.stubEnv("SMTP_URL", "http://user:hunter2@smtp.example.com");
    const error = await loadEnv().then(
      () => undefined,
      (reason: Error) => reason,
    );
    expect(error?.message).toMatch(/SMTP_URL must be an smtp/);
    expect(error?.message).not.toContain("hunter2");
  });

  it("requires the mail settings", async () => {
    vi.stubEnv("SMTP_URL", "");
    await expect(loadEnv()).rejects.toThrow(/SMTP_URL/);
    vi.stubEnv("SMTP_URL", "smtp://localhost:1025");
    vi.stubEnv("MAIL_FROM", "");
    await expect(loadEnv()).rejects.toThrow(/MAIL_FROM/);
  });

  it.each(["no-reply@example.com", "Fullstack Starter <no-reply@example.com>"])(
    "accepts the sender %s",
    async (from) => {
      vi.stubEnv("MAIL_FROM", from);
      expect((await loadEnv()).MAIL_FROM).toBe(from);
    },
  );

  it.each(["Fullstack Starter", "no-reply@", "<no-reply@example.com"])(
    "rejects the sender %s",
    async (from) => {
      vi.stubEnv("MAIL_FROM", from);
      await expect(loadEnv()).rejects.toThrow(/MAIL_FROM/);
    },
  );

  it("does not require email verification unless asked to", async () => {
    expect((await loadEnv()).AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(false);
    vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "true");
    expect((await loadEnv()).AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(true);
  });

  it("rejects a flag that is not true or false, so a typo cannot switch verification off", async () => {
    vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "yes");
    await expect(loadEnv()).rejects.toThrow(
      /AUTH_REQUIRE_EMAIL_VERIFICATION must be "true" or "false"/,
    );
  });

  it("lower-cases the IP header and leaves it unset by default", async () => {
    expect((await loadEnv()).AUTH_IP_HEADER).toBeUndefined();
    vi.stubEnv("AUTH_IP_HEADER", "CF-Connecting-IP");
    expect((await loadEnv()).AUTH_IP_HEADER).toBe("cf-connecting-ip");
  });

  it("rejects an IP header that is not a single header name", async () => {
    vi.stubEnv("AUTH_IP_HEADER", "x-real-ip, x-forwarded-for");
    await expect(loadEnv()).rejects.toThrow(/AUTH_IP_HEADER must be one header name/);
  });

  it("parses trusted proxies as IPs and CIDR ranges", async () => {
    vi.stubEnv("AUTH_TRUSTED_PROXIES", "10.0.0.0/24, 192.0.2.10 ,2001:db8::/32");
    expect((await loadEnv()).AUTH_TRUSTED_PROXIES).toEqual([
      "10.0.0.0/24",
      "192.0.2.10",
      "2001:db8::/32",
    ]);
  });

  it.each(["web", "10.0.0.0/33", "10.0.0.0/24/8", "2001:db8::/129", "10.0.0.0/x"])(
    "rejects the trusted proxy %s",
    async (entry) => {
      vi.stubEnv("AUTH_TRUSTED_PROXIES", `10.0.0.1,${entry}`);
      await expect(loadEnv()).rejects.toThrow(/AUTH_TRUSTED_PROXIES/);
    },
  );
});
