import { reportError } from "./lib/error-reporter";

// Browser errors that no React error boundary sees: a throwing event handler,
// a rejected promise nobody awaited. Runs before the app becomes interactive.
// Render errors are reported by error.tsx and global-error.tsx, failed API
// calls by the query client in components/providers.tsx.
window.addEventListener("error", (event) => {
  void reportError(event.error ?? new Error(event.message), {
    source: "browser",
    route: window.location.pathname,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  void reportError(event.reason, { source: "browser", route: window.location.pathname });
});
