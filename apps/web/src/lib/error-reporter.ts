// The one seam for error reporting, on the server and in the browser. No
// vendor SDK ships with the app: errors are already logged (server errors by
// Next.js, API errors by the Go API with their request and trace IDs), and
// `sink` below does nothing more. To send errors to a service, replace the
// body of `sink`, and nothing else:
//
//   async function sink(error: unknown, context: ErrorContext) {
//     if (typeof window === "undefined") {
//       const { captureServer } = await import("./vendor-server"); // posthog-node, @sentry/node, ...
//       await captureServer(error, context);
//     } else {
//       const { captureBrowser } = await import("./vendor-browser"); // posthog-js, @sentry/browser, ...
//       captureBrowser(error, context);
//     }
//   }
//
// The dynamic imports keep a server SDK out of the browser bundle and a
// browser SDK out of the first paint.
//
// What reaches `sink` is limited on purpose. The context is an allow-list of
// short, low-cardinality facts. It never carries tokens, cookies, headers,
// emails, query strings (a reset link's token lives there) or request bodies,
// and API errors are reduced to their status, because a problem-details body
// can quote what the user typed. Keep it that way when adding a field.

export type ErrorSource =
  /** A Server Component, route handler or the proxy threw (instrumentation.ts). */
  | "server"
  /** A render error caught by an error boundary (error.tsx, global-error.tsx). */
  | "render"
  /** An uncaught browser error or unhandled rejection (instrumentation-client.ts). */
  | "browser"
  /** A query or mutation failed in a way the user did not cause (providers.tsx). */
  | "query"
  | "mutation";

export type ErrorContext = {
  source: ErrorSource;
  /** Route pattern or pathname. Never a full URL: the query string is dropped. */
  route?: string;
  method?: string;
  /** HTTP status of a failed API call. */
  status?: number;
  /** Next.js digest: matches a browser-side render error to the server log line. */
  digest?: string;
  /** Generated operation name, such as `listClients`. */
  operation?: string;
  /** Next.js: render, route, action or proxy. */
  routeType?: string;
};

// The default: nothing beyond what is already logged. The parameters are the
// contract a vendor implementation fills in.
async function sink(error: unknown, context: ErrorContext): Promise<void> {
  void error;
  void context;
}

const MAX_LENGTH = 200;
const STRING_FIELDS = ["route", "method", "digest", "operation", "routeType"] as const;
const SOURCES = new Set<unknown>(["server", "render", "browser", "query", "mutation"]);

/** Drops the query string and fragment: `/reset-password?token=...` becomes `/reset-password`. */
export function pathOnly(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

/**
 * Rebuilds the context from the allow-list, whatever object it was handed, so
 * a caller that spreads a request or a query key into it cannot leak anything.
 */
export function safeContext(context: ErrorContext): ErrorContext {
  const input = context as Record<string, unknown>;
  const safe: ErrorContext = {
    source: SOURCES.has(input.source) ? (input.source as ErrorSource) : "server",
  };
  for (const field of STRING_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value !== "") {
      const cleaned = field === "route" ? pathOnly(value) : value;
      safe[field] = cleaned.slice(0, MAX_LENGTH);
    }
  }
  if (typeof input.status === "number" && Number.isInteger(input.status)) {
    safe.status = input.status;
  }
  return safe;
}

/** Reports an error. Never throws: reporting must not break what it observes. */
export async function reportError(error: unknown, context: ErrorContext): Promise<void> {
  try {
    await sink(error, safeContext(context));
  } catch {
    // A failing reporter has nowhere better to report to.
  }
}

/**
 * Whether a failed API call is worth reporting. 4xx answers are the normal
 * flow (validation, conflicts, an expired token, the rate limit); a 5xx or a
 * request that never got an answer is not.
 */
export function isUnexpectedApiError(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status >= 500;
}

/**
 * What to hand the reporter for a failed API call: the status only. The
 * problem-details body is left behind, since `detail` and `errors[].value` can
 * quote user input. Errors that are not API answers (a network failure) pass
 * through: their messages come from the browser, not from user data.
 */
export function apiErrorForReport(error: unknown): unknown {
  if (isContractMismatch(error)) {
    // The response failed the generated zod schema: the API and this build
    // disagree about the contract. Only the paths are kept; an issue can
    // describe the value it rejected.
    const paths = error.issues.map((issue) => issue.path.join(".") || "(root)");
    return new Error(
      `API response did not match the contract at: ${[...new Set(paths)].join(", ")}`,
    );
  }
  const status = statusOf(error);
  return status === undefined ? error : new Error(`API request failed with status ${status}`);
}

/** A ZodError, recognised by shape so this file does not import zod. */
function isContractMismatch(
  error: unknown,
): error is { issues: Array<{ path: Array<string | number> }> } {
  return (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}

export function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}
