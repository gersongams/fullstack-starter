import { describe, expect, it } from "vitest";

import { zClientFields } from "@/lib/api/gen/zod.gen";

import { clientSchema, toBody, toValues } from "./schema";

describe("clientSchema", () => {
  it("accepts a name alone, with the optional fields blank", () => {
    const result = clientSchema.safeParse({ name: " Acme ", email: "", tax_id: "", notes: "" });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Acme");
  });

  it.each([
    ["a blank name", { name: "   " }, "name"],
    ["a name over 200 characters", { name: "a".repeat(201) }, "name"],
    ["a malformed email", { email: "nope" }, "email"],
    ["a tax id over 50 characters", { tax_id: "1".repeat(51) }, "tax_id"],
    ["notes over 5000 characters", { notes: "n".repeat(5001) }, "notes"],
  ])("rejects %s", (_, override, field) => {
    const result = clientSchema.safeParse({
      name: "Acme",
      email: "",
      tax_id: "",
      notes: "",
      ...override,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([field]);
  });
});

describe("toBody", () => {
  it("omits blank optional fields, because the API rejects an empty email", () => {
    expect(toBody({ name: "Acme", email: " ", tax_id: "", notes: "  " })).toEqual({ name: "Acme" });
  });

  it("trims what it sends", () => {
    expect(
      toBody({ name: " Acme ", email: " billing@acme.test ", tax_id: " 20123 ", notes: "late" }),
    ).toEqual({ name: "Acme", email: "billing@acme.test", tax_id: "20123", notes: "late" });
  });
});

describe("toValues", () => {
  it("turns the API's nulls into the empty strings inputs need", () => {
    expect(
      toValues({
        id: "0198c5a0-0000-7000-8000-000000000000",
        name: "Acme",
        email: null,
        tax_id: null,
        notes: "",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({ name: "Acme", email: "", tax_id: "", notes: "" });
  });
});

describe("the form and the API contract", () => {
  const atTheLimit = {
    name: "n".repeat(200),
    email: `${"e".repeat(308)}@example.com`,
    tax_id: "t".repeat(50),
    notes: "x".repeat(5000),
  };

  it.each([
    ["only a name", { name: "Acme", email: "", tax_id: "", notes: "" }],
    [
      "every field, padded with spaces",
      {
        name: "  Acme  ",
        email: " billing@acme.test ",
        tax_id: " 20123456789 ",
        notes: " late payer ",
      },
    ],
    ["every field at its limit", atTheLimit],
  ])("produces a body the contract accepts: %s", (_, input) => {
    const values = clientSchema.parse(input);
    expect(() => zClientFields.parse(toBody(values))).not.toThrow();
  });

  it.each([
    ["name", { ...atTheLimit, name: "n".repeat(201) }],
    ["email", { ...atTheLimit, email: `${"e".repeat(309)}@example.com` }],
    ["tax_id", { ...atTheLimit, tax_id: "t".repeat(51) }],
    ["notes", { ...atTheLimit, notes: "x".repeat(5001) }],
  ])("rejects one character past the contract's limit for %s", (field, input) => {
    const result = clientSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([field]);
  });

  it("takes its limits from the contract, not from constants of its own", () => {
    const limits = {
      name: zClientFields.shape.name.maxLength,
      email: zClientFields.shape.email.unwrap().maxLength,
      tax_id: zClientFields.shape.tax_id.unwrap().maxLength,
      notes: zClientFields.shape.notes.unwrap().maxLength,
    };
    // If the Go API changes a limit, `make generate` changes these and the two
    // tests above must be updated with it: that is the drift alarm.
    expect(limits).toEqual({ name: 200, email: 320, tax_id: 50, notes: 5000 });
  });
});
