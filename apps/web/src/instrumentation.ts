import { registerOTel } from "@vercel/otel";
import type { Instrumentation } from "next";

import { reportError } from "./lib/error-reporter";

// Tracing is off until an OTLP endpoint is configured, the same switch the Go
// API uses. Everything else (headers, sampler, resource attributes) comes from
// the standard OTEL_* variables.
export function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return;
  }
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME ?? "starter-web" });
}

// Server-side errors: Server Components, route handlers and the proxy. Next.js
// has already logged the error; this hands it to the reporter. Of the request,
// only the method and the path without its query string are passed on: the
// headers carry the session cookie and a reset link carries its token in the
// query. Awaited, as the Next.js docs require for async work here.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await reportError(error, {
    source: "server",
    route: context.routePath || request.path,
    method: request.method,
    routeType: context.routeType,
    digest:
      typeof error === "object" && error !== null && "digest" in error
        ? String(error.digest)
        : undefined,
  });
};
