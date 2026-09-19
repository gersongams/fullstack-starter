import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({ authClient: { token: tokenMock } }));

import { clearApiToken, getApiToken } from "./token";

const NOW = new Date("2026-01-01T00:00:00Z");

/** An unsigned JWT whose only claim is `exp`; token.ts reads nothing else. */
function jwt(label: string, expiresInMs: number): string {
  const exp = Math.floor((NOW.getTime() + expiresInMs) / 1000);
  const payload = btoa(JSON.stringify({ exp, label }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

type TokenResult = { data: { token: string } | null; error: unknown };

/** A pending authClient.token() call the test resolves by hand. */
function deferredToken() {
  let resolve!: (result: TokenResult) => void;
  const promise = new Promise<TokenResult>((r) => {
    resolve = r;
  });
  tokenMock.mockReturnValueOnce(promise);
  return { resolve: (token: string) => resolve({ data: { token }, error: null }) };
}

const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  tokenMock.mockReset();
  // The cache is module state; start every test signed out.
  clearApiToken();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getApiToken", () => {
  it("fetches once and serves later calls from memory", async () => {
    const token = jwt("a", 15 * MINUTE);
    tokenMock.mockResolvedValue({ data: { token }, error: null });

    expect(await getApiToken()).toBe(token);
    expect(await getApiToken()).toBe(token);
    expect(tokenMock).toHaveBeenCalledTimes(1);
  });

  it("shares one request between concurrent callers", async () => {
    const pending = deferredToken();
    const first = getApiToken();
    const second = getApiToken();

    const token = jwt("a", 15 * MINUTE);
    pending.resolve(token);

    expect(await Promise.all([first, second])).toEqual([token, token]);
    expect(tokenMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes a token that is about to expire", async () => {
    const soon = jwt("old", 15 * MINUTE);
    const fresh = jwt("new", 30 * MINUTE);
    tokenMock
      .mockResolvedValueOnce({ data: { token: soon }, error: null })
      .mockResolvedValueOnce({ data: { token: fresh }, error: null });

    expect(await getApiToken()).toBe(soon);

    // Still comfortably valid: no refresh.
    vi.setSystemTime(NOW.getTime() + 13 * MINUTE);
    expect(await getApiToken()).toBe(soon);
    expect(tokenMock).toHaveBeenCalledTimes(1);

    // Inside the one-minute refresh margin.
    vi.setSystemTime(NOW.getTime() + 14 * MINUTE + 30_000);
    expect(await getApiToken()).toBe(fresh);
    expect(tokenMock).toHaveBeenCalledTimes(2);
  });

  it("returns no token and caches nothing when there is no session", async () => {
    tokenMock.mockResolvedValue({ data: null, error: { status: 401 } });

    expect(await getApiToken()).toBeUndefined();
    expect(await getApiToken()).toBeUndefined();
    expect(tokenMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a token it cannot read an expiry from", async () => {
    tokenMock.mockResolvedValue({ data: { token: "not-a-jwt" }, error: null });

    expect(await getApiToken()).toBe("not-a-jwt");
    await getApiToken();
    expect(tokenMock).toHaveBeenCalledTimes(2);
  });
});

describe("clearApiToken", () => {
  it("forgets the cached token", async () => {
    const first = jwt("a", 15 * MINUTE);
    const second = jwt("b", 15 * MINUTE);
    tokenMock
      .mockResolvedValueOnce({ data: { token: first }, error: null })
      .mockResolvedValueOnce({ data: { token: second }, error: null });

    expect(await getApiToken()).toBe(first);
    clearApiToken();
    expect(await getApiToken()).toBe(second);
  });

  it("discards a request that was in flight when it ran", async () => {
    // User A's token request is pending when A signs out.
    const requestA = deferredToken();
    const callA = getApiToken();
    clearApiToken();

    requestA.resolve(jwt("user-a", 15 * MINUTE));
    expect(await callA).toBeUndefined();

    // A's late token was not written back: the next call asks again.
    const tokenB = jwt("user-b", 15 * MINUTE);
    tokenMock.mockResolvedValueOnce({ data: { token: tokenB }, error: null });
    expect(await getApiToken()).toBe(tokenB);
    expect(tokenMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a stale request reset a newer one", async () => {
    const requestA = deferredToken();
    const callA = getApiToken();
    clearApiToken();

    // User B's request starts while A's is still pending.
    const requestB = deferredToken();
    const callB = getApiToken();

    // A settles first. Its cleanup must leave B's in-flight request alone, so
    // a concurrent caller still shares B's request instead of starting a third.
    requestA.resolve(jwt("user-a", 15 * MINUTE));
    await callA;
    const callB2 = getApiToken();

    const tokenB = jwt("user-b", 15 * MINUTE);
    requestB.resolve(tokenB);
    expect(await Promise.all([callB, callB2])).toEqual([tokenB, tokenB]);
    expect(tokenMock).toHaveBeenCalledTimes(2);
    expect(await getApiToken()).toBe(tokenB);
  });
});
