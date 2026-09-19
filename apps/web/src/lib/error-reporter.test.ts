import { describe, expect, it } from "vitest";

import {
  apiErrorForReport,
  isUnexpectedApiError,
  pathOnly,
  reportError,
  safeContext,
  type ErrorContext,
} from "./error-reporter";

describe("safeContext", () => {
  it("keeps only the allow-listed fields", () => {
    const leaky = {
      source: "server",
      route: "/clients",
      method: "GET",
      status: 503,
      digest: "abc123",
      operation: "listClients",
      routeType: "render",
      // None of these may survive, however they got in.
      headers: { cookie: "better-auth.session_token=secret", authorization: "Bearer jwt" },
      email: "ada@example.com",
      body: { password: "hunter2hunter2" },
      token: "jwt",
      queryKey: [{ _id: "listClients", query: { q: "ada@example.com" } }],
    } as unknown as ErrorContext;

    expect(safeContext(leaky)).toEqual({
      source: "server",
      route: "/clients",
      method: "GET",
      status: 503,
      digest: "abc123",
      operation: "listClients",
      routeType: "render",
    });
  });

  it("drops the query string from the route, where reset tokens live", () => {
    const context = safeContext({ source: "server", route: "/reset-password?token=s3cret#frag" });
    expect(context.route).toBe("/reset-password");
    expect(JSON.stringify(context)).not.toContain("s3cret");
  });

  it("ignores values of the wrong type and caps long strings", () => {
    const context = safeContext({
      source: "nonsense",
      route: { toString: () => "/x" },
      status: "500",
      operation: "x".repeat(500),
    } as unknown as ErrorContext);

    expect(context.source).toBe("server");
    expect(context.route).toBeUndefined();
    expect(context.status).toBeUndefined();
    expect(context.operation).toHaveLength(200);
  });
});

describe("pathOnly", () => {
  it.each([
    ["/clients", "/clients"],
    ["/clients?q=ada", "/clients"],
    ["/email-verified#done", "/email-verified"],
    ["/api/auth/verify-email?token=abc&callbackURL=/x", "/api/auth/verify-email"],
  ])("%s -> %s", (input, expected) => {
    expect(pathOnly(input)).toBe(expected);
  });
});

describe("isUnexpectedApiError", () => {
  it.each([
    [{ status: 400 }, false],
    [{ status: 401 }, false],
    [{ status: 409 }, false],
    [{ status: 422 }, false],
    [{ status: 429 }, false],
    [{ status: 500 }, true],
    [{ status: 503 }, true],
    [new TypeError("Failed to fetch"), true],
    [undefined, true],
  ])("%o -> %s", (error, expected) => {
    expect(isUnexpectedApiError(error)).toBe(expected);
  });
});

describe("apiErrorForReport", () => {
  it("reduces a problem-details body to its status", () => {
    const problem = {
      status: 500,
      title: "Internal Server Error",
      detail: "could not save ada@example.com",
      errors: [{ location: "body.email", value: "ada@example.com" }],
    };

    const reported = apiErrorForReport(problem);

    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("API request failed with status 500");
    expect(JSON.stringify(reported, Object.getOwnPropertyNames(reported))).not.toContain("ada@");
  });

  it("passes a network failure through", () => {
    const failure = new TypeError("Failed to fetch");
    expect(apiErrorForReport(failure)).toBe(failure);
  });
});

describe("reportError", () => {
  it("never throws, even for a hostile context", async () => {
    const hostile = new Proxy({} as ErrorContext, {
      get() {
        throw new Error("boom");
      },
    });
    await expect(reportError(new Error("x"), hostile)).resolves.toBeUndefined();
  });
});

describe("a response that does not match the contract", () => {
  it("is unexpected, and is reported by path without the rejected values", async () => {
    const { z } = await import("zod");
    const schema = z.object({ items: z.array(z.object({ name: z.string() })) });
    const result = schema.safeParse({ items: [{ name: "ok" }, { name: 20123456789 }] });
    if (result.success) throw new Error("the fixture should not parse");

    expect(isUnexpectedApiError(result.error)).toBe(true);
    const reported = apiErrorForReport(result.error);
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe(
      "API response did not match the contract at: items.1.name",
    );
    expect((reported as Error).message).not.toContain("20123456789");
  });
});
