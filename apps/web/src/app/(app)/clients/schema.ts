import { z } from "zod";

import type { Client, ClientFields } from "@/lib/api/gen/types.gen";
import { zClientFields } from "@/lib/api/gen/zod.gen";

const api = zClientFields.shape;

/** The maxLength the contract gives a string field, optional or not. */
function limit(field: z.ZodString | z.ZodEmail | z.ZodOptional<z.ZodString | z.ZodEmail>): number {
  const inner = field instanceof z.ZodOptional ? field.unwrap() : field;
  if (inner.maxLength === null) {
    throw new Error("The API contract no longer limits this field; update the form schema.");
  }
  return inner.maxLength;
}

const tooLong = (max: number) => `Use ${max.toLocaleString("en")} characters or fewer`;

// The form's own schema: it validates what the inputs hold ("" for a blank
// optional field) and words the messages for people. The limits are read from
// the schema generated from the API contract, so they cannot drift from the Go
// API, and schema.test.ts checks that every body this form can produce is one
// the contract accepts.
export const clientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the client's name")
    .max(limit(api.name), tooLong(limit(api.name))),
  email: z
    .string()
    .trim()
    .max(limit(api.email), tooLong(limit(api.email)))
    .refine((value) => value === "" || z.email().safeParse(value).success, {
      message: "Enter a valid email address",
    }),
  tax_id: z
    .string()
    .trim()
    .max(limit(api.tax_id), tooLong(limit(api.tax_id))),
  notes: z.string().max(limit(api.notes), tooLong(limit(api.notes))),
});

export type ClientValues = z.infer<typeof clientSchema>;

export const CLIENT_FIELDS = ["name", "email", "tax_id", "notes"] as const;

export const EMPTY_CLIENT: ClientValues = { name: "", email: "", tax_id: "", notes: "" };

export function toValues(client: Client): ClientValues {
  return {
    name: client.name,
    email: client.email ?? "",
    tax_id: client.tax_id ?? "",
    notes: client.notes,
  };
}

/**
 * The request body for create and update. Blank optional fields are left out:
 * the API rejects "" for email, and an update replaces every field, so leaving
 * one out is how it gets cleared.
 */
export function toBody(values: ClientValues): ClientFields {
  const body: ClientFields = { name: values.name.trim() };
  const email = values.email.trim();
  const taxId = values.tax_id.trim();
  if (email) body.email = email;
  if (taxId) body.tax_id = taxId;
  if (values.notes.trim()) body.notes = values.notes;
  return body;
}
