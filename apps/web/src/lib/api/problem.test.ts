import { describe, expect, it } from "vitest";

import { describeProblem, mapProblemToForm } from "./problem";

const fields = ["name", "email", "tax_id", "notes"] as const;

describe("mapProblemToForm", () => {
  it("puts located validation errors under their fields", () => {
    const result = mapProblemToForm(
      {
        status: 422,
        title: "Unprocessable Entity",
        detail: "validation failed",
        errors: [
          { location: "body.name", message: "must not be blank" },
          { location: "body.email", message: "expected string to be RFC 5322 email" },
        ],
      },
      { fields },
    );

    expect(result).toEqual({
      fieldErrors: {
        name: "Must not be blank",
        email: "Expected string to be RFC 5322 email",
      },
    });
  });

  it("keeps the first message when a field is reported twice", () => {
    const result = mapProblemToForm(
      {
        status: 422,
        errors: [
          { location: "body.name", message: "first" },
          { location: "body.name", message: "second" },
        ],
      },
      { fields },
    );
    expect(result.fieldErrors.name).toBe("First");
  });

  it("resolves nested locations to the top-level field", () => {
    const result = mapProblemToForm(
      { status: 422, errors: [{ location: "body.notes[0].text", message: "too long" }] },
      { fields },
    );
    expect(result.fieldErrors).toEqual({ notes: "Too long" });
  });

  it("sends a conflict to the configured field", () => {
    const result = mapProblemToForm(
      { status: 409, title: "Conflict", detail: "another client already uses this tax id" },
      { fields, conflictField: "tax_id" },
    );
    expect(result).toEqual({
      fieldErrors: { tax_id: "another client already uses this tax id" },
    });
  });

  it("reports a conflict at form level when no field is configured for it", () => {
    const result = mapProblemToForm({ status: 409, detail: "conflict" }, { fields });
    expect(result).toEqual({ fieldErrors: {}, formError: "conflict" });
  });

  it("reports errors on unknown or non-body locations at form level", () => {
    const result = mapProblemToForm(
      {
        status: 422,
        errors: [
          { location: "body.user_id", message: "unexpected property" },
          { location: "query.cursor", message: "invalid" },
        ],
      },
      { fields },
    );
    expect(result.fieldErrors).toEqual({});
    expect(result.formError).toBe("body.user_id: unexpected property. query.cursor: invalid");
  });

  it("uses the detail when the problem lists no errors", () => {
    expect(mapProblemToForm({ status: 503, detail: "try later" }, { fields })).toEqual({
      fieldErrors: {},
      formError: "try later",
    });
  });

  it("falls back to a generic message for anything that is not a problem", () => {
    const result = mapProblemToForm(new TypeError("Failed to fetch"), { fields });
    expect(result.fieldErrors).toEqual({});
    expect(result.formError).toMatch(/could not be completed/);
  });
});

describe("describeProblem", () => {
  it("prefers detail, then title, then the fallback", () => {
    expect(describeProblem({ status: 404, title: "Not Found", detail: "client not found" })).toBe(
      "client not found",
    );
    expect(describeProblem({ status: 404, title: "Not Found" })).toBe("Not Found");
    expect(describeProblem(undefined, "nope")).toBe("nope");
  });
});
