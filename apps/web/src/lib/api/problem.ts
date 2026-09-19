// The Go API answers every error with RFC 9457 problem details. Validation
// failures list the offending fields in `errors`, located as `body.<field>`.

export type Problem = {
  status?: number;
  title?: string;
  detail?: string;
  errors?: Array<{ location?: string; message?: string }> | null;
};

export type FormProblem<Field extends string> = {
  /** Messages to show under the matching fields. */
  fieldErrors: Partial<Record<Field, string>>;
  /** Message for a form-level alert when the problem belongs to no known field. */
  formError?: string;
};

const GENERIC_FAILURE = "The request could not be completed. Check your connection and try again.";

export function isProblem(error: unknown): error is Problem {
  return (
    typeof error === "object" &&
    error !== null &&
    ("status" in error || "detail" in error || "title" in error)
  );
}

/** A sentence for the user, from whatever a request threw. */
export function describeProblem(error: unknown, fallback = GENERIC_FAILURE): string {
  if (isProblem(error)) {
    return error.detail || error.title || fallback;
  }
  return fallback;
}

/**
 * Splits an API error into per-field messages and a form-level message.
 *
 * - `errors[].location` of `body.<field>` goes to that field when the form has it.
 * - A 409 goes to `conflictField`: the API reports a uniqueness conflict
 *   without a location.
 * - Everything else becomes `formError`.
 */
export function mapProblemToForm<Field extends string>(
  error: unknown,
  options: { fields: readonly Field[]; conflictField?: Field },
): FormProblem<Field> {
  const result: FormProblem<Field> = { fieldErrors: {} };
  if (!isProblem(error)) {
    result.formError = GENERIC_FAILURE;
    return result;
  }

  if (error.status === 409 && options.conflictField) {
    result.fieldErrors[options.conflictField] = describeProblem(error);
    return result;
  }

  const unplaced: string[] = [];
  for (const detail of error.errors ?? []) {
    const field = fieldOf(detail.location, options.fields);
    const message = detail.message || "Invalid value";
    if (field && !result.fieldErrors[field]) {
      result.fieldErrors[field] = capitalise(message);
    } else if (!field) {
      unplaced.push(detail.location ? `${detail.location}: ${message}` : message);
    }
  }

  if (unplaced.length > 0) {
    result.formError = unplaced.join(". ");
  } else if (Object.keys(result.fieldErrors).length === 0) {
    result.formError = describeProblem(error);
  }
  return result;
}

function fieldOf<Field extends string>(
  location: string | undefined,
  fields: readonly Field[],
): Field | undefined {
  // "body.tax_id" and "body.lines[0].amount" both resolve to their first segment.
  const match = /^body\.([^.[]+)/.exec(location ?? "");
  return fields.find((field) => field === match?.[1]);
}

function capitalise(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}
