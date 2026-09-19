import { describe, expect, it } from "vitest";

import { createIdempotencyKeys } from "./idempotency";

describe("createIdempotencyKeys", () => {
  it("reuses the key when the same body is submitted again", () => {
    const keyFor = createIdempotencyKeys();
    const first = keyFor({ name: "Acme", tax_id: "20123456789" });
    expect(keyFor({ name: "Acme", tax_id: "20123456789" })).toBe(first);
  });

  it("issues a new key when the body changes", () => {
    const keyFor = createIdempotencyKeys();
    const first = keyFor({ name: "Acme" });
    const edited = keyFor({ name: "Acme Ltd" });
    expect(edited).not.toBe(first);
    // Going back to the first body is a new request too: its key may already
    // hold the response of an attempt the user has since moved on from.
    expect(keyFor({ name: "Acme" })).not.toBe(first);
  });

  it("keeps separate forms apart", () => {
    const body = { name: "Acme" };
    expect(createIdempotencyKeys()(body)).not.toBe(createIdempotencyKeys()(body));
  });
});
