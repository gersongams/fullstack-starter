import { authClient } from "@/lib/auth-client";

// The Go API takes a short-lived JWT, not the session cookie. Better Auth mints
// one for the signed-in user; it is kept in memory only, never in storage.

const REFRESH_MARGIN_MS = 60_000;

type CachedToken = { value: string; expiresAt: number };

let cached: CachedToken | undefined;
let inFlight: Promise<string | undefined> | undefined;
// Bumped by clearApiToken so a request started before the clear cannot write
// its result back afterwards.
let generation = 0;

function expiryOf(token: string): number {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function fetchToken(startedIn: number): Promise<string | undefined> {
  const { data, error } = await authClient.token();
  if (startedIn !== generation) {
    // Cleared while this was in flight: the token may belong to a previous user.
    return undefined;
  }
  if (error || !data?.token) {
    // Not signed in (or the session expired): send the request without a token
    // and let the API answer 401.
    cached = undefined;
    return undefined;
  }
  cached = { value: data.token, expiresAt: expiryOf(data.token) };
  return data.token;
}

/** Returns a valid API token, refreshing it shortly before it expires. */
export function getApiToken(): Promise<string | undefined> {
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return Promise.resolve(cached.value);
  }
  // Concurrent callers share a single request.
  if (!inFlight) {
    const request = fetchToken(generation).finally(() => {
      if (inFlight === request) {
        inFlight = undefined;
      }
    });
    inFlight = request;
  }
  return inFlight;
}

/** Forget the token, e.g. on sign-out or when another user signs in. */
export function clearApiToken(): void {
  generation += 1;
  cached = undefined;
  inFlight = undefined;
}
