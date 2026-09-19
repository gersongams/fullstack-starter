import type { Route } from "next";

// Where to send someone after signing in. The value comes from a query
// parameter, so it is attacker-controlled: an unchecked `?next=` turns the
// sign-in page into an open redirect for phishing links.

const FALLBACK: Route = "/dashboard";

// Pages that send a signed-in visitor on to `next`. Letting `next` point at
// one of them would make a redirect loop out of a valid session.
const PUBLIC_AUTH_PATHS = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/email-verified",
];

/**
 * Returns `value` when it is a plain same-origin path, otherwise the fallback.
 * Absolute URLs, protocol-relative URLs (`//evil.example`), backslash tricks
 * (`/\evil.example`), control characters, API routes and the auth pages
 * themselves are all rejected.
 */
export function safeRedirectPath(
  value: string | string[] | undefined | null,
  fallback: Route = FALLBACK,
): Route {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // oxlint-disable-next-line no-control-regex -- control characters are the point.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  // Resolve it the way a browser would and make sure it stayed on this origin.
  const base = "http://app.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;

  const path = url.pathname;
  if (path === "/" || path === "/api" || path.startsWith("/api/")) return fallback;
  if (PUBLIC_AUTH_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return fallback;
  }
  // Checked above: a path on this origin. Typed routes cannot know it statically.
  return `${path}${url.search}${url.hash}` as Route;
}
