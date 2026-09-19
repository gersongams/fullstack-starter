import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/clients", "/clients"],
    ["/clients?q=acme&limit=5", "/clients?q=acme&limit=5"],
    ["/clients/0198a3f0#notes", "/clients/0198a3f0#notes"],
    ["/dashboard", "/dashboard"],
  ])("keeps the same-origin path %s", (value, want) => {
    expect(safeRedirectPath(value)).toBe(want);
  });

  it.each([
    ["an absolute URL", "https://evil.example/login"],
    ["a protocol-relative URL", "//evil.example"],
    ["a protocol-relative URL with a path", "//evil.example/%2f.."],
    ["a backslash the browser reads as a slash", "/\\evil.example"],
    ["a backslash later in the path", "/clients\\..\\evil"],
    ["a scheme without slashes", "javascript:alert(1)"],
    ["a relative path", "clients"],
    ["a tab the URL parser strips, leaving //", "/\t/evil.example"],
    ["a newline", "/clients\nSet-Cookie: x=1"],
    ["an API route", "/api/auth/sign-out"],
    ["the API root", "/api"],
    ["the home page, which redirects again", "/"],
    ["an empty string", ""],
    ["a repeated parameter", ["/clients", "/dashboard"]],
    ["nothing", undefined],
    ["a very long value", `/${"a".repeat(3000)}`],
  ])("falls back for %s", (_name, value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  // With a valid session each of these pages redirects to `next`: pointing
  // `next` back at one of them would loop.
  it.each([
    "/sign-in",
    "/sign-in?next=/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/email-verified",
    "/sign-in/",
  ])("falls back for the auth page %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  it("normalises dot segments before checking, so they cannot smuggle an auth page", () => {
    expect(safeRedirectPath("/clients/../sign-in")).toBe("/dashboard");
    expect(safeRedirectPath("/clients/../api/auth/sign-out")).toBe("/dashboard");
    expect(safeRedirectPath("/clients/./x")).toBe("/clients/x");
  });

  it("does not mistake a longer path for an auth page", () => {
    expect(safeRedirectPath("/sign-installation")).toBe("/sign-installation");
  });

  it("uses the given fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/clients")).toBe("/clients");
  });
});
