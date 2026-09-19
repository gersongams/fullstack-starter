// Server-side environment. Import this only from server code: none of these
// values may reach the browser.

import { isIP } from "node:net";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy apps/web/.env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function requiredUrl(name: string): string {
  const value = required(name);
  // URL.canParse alone accepts "localhost:3100", reading "localhost:" as the scheme.
  if (!URL.canParse(value) || !["http:", "https:"].includes(new URL(value).protocol)) {
    throw new Error(
      `Environment variable ${name} must be an http(s) URL such as http://localhost:3100, got "${value}".`,
    );
  }
  return value.replace(/\/$/, "");
}

function smtpUrl(name: string): string {
  const value = required(name);
  if (!URL.canParse(value) || !["smtp:", "smtps:"].includes(new URL(value).protocol)) {
    // The value may hold a password, so it is not echoed.
    throw new Error(
      `Environment variable ${name} must be an smtp:// or smtps:// URL such as smtp://localhost:10025.`,
    );
  }
  return value;
}

function mailbox(name: string): string {
  const value = required(name);
  // "Name <address>" or a bare address.
  if (!/^(?:[^<>@]+<[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/.test(value.trim())) {
    throw new Error(
      `Environment variable ${name} must be an address such as "Fullstack Starter <no-reply@example.com>", got "${value}".`,
    );
  }
  return value.trim();
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  if (value !== "true" && value !== "false") {
    // A typo must not silently turn a security setting off.
    throw new Error(`Environment variable ${name} must be "true" or "false", got "${value}".`);
  }
  return value === "true";
}

function headerName(name: string): string | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (!/^[a-z0-9-]+$/.test(value)) {
    throw new Error(
      `Environment variable ${name} must be one header name such as cf-connecting-ip, got "${value}".`,
    );
  }
  return value;
}

function cidrList(name: string): string[] | undefined {
  const entries = (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  for (const entry of entries) {
    const [address, prefix, ...rest] = entry.split("/");
    const version = isIP(address ?? "");
    const max = version === 4 ? 32 : 128;
    const validPrefix =
      prefix === undefined ||
      (/^\d+$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= max);
    if (version === 0 || rest.length > 0 || !validPrefix) {
      throw new Error(
        `Environment variable ${name} must be a comma-separated list of IPs or CIDR ranges such as 10.0.0.0/24, got "${entry}".`,
      );
    }
  }
  return entries;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  /** Public origin of the web app. Also the issuer of the API tokens. */
  BETTER_AUTH_URL: requiredUrl("BETTER_AUTH_URL"),
  /** Audience of the API tokens. Must match AUTH_AUDIENCE in the Go API. */
  API_JWT_AUDIENCE: process.env.API_JWT_AUDIENCE || "starter-api",

  /** SMTP server for verification and password-reset emails. Mailpit in development. */
  SMTP_URL: smtpUrl("SMTP_URL"),
  /** The From header of every email. */
  MAIL_FROM: mailbox("MAIL_FROM"),

  /** When true, nobody gets a session before confirming their email address. */
  AUTH_REQUIRE_EMAIL_VERIFICATION: flag("AUTH_REQUIRE_EMAIL_VERIFICATION", false),
  /**
   * The header the rate limiter reads the client address from. Set it to the
   * header your proxy or CDN sets and overwrites. Unset means x-forwarded-for.
   */
  AUTH_IP_HEADER: headerName("AUTH_IP_HEADER"),
  /**
   * Proxies whose entries in a forwarded chain are skipped when looking for the
   * client address. Without it only a single-value header is believed.
   */
  AUTH_TRUSTED_PROXIES: cidrList("AUTH_TRUSTED_PROXIES"),
};
