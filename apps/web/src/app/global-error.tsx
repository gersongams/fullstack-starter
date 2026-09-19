"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/states";
import { reportError } from "@/lib/error-reporter";

// Replaces the root layout when it, or anything no closer boundary caught,
// fails to render, so it brings its own document and styles. Kept free of
// providers and fonts: the less it depends on, the less can fail here too.
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    void reportError(error, {
      source: "render",
      route: window.location.pathname,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <title>Something went wrong · Fullstack Starter</title>
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 px-6 py-16">
          <div className="space-y-1">
            <p className="text-sm font-semibold tracking-tight">Fullstack Starter</p>
            <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          </div>
          <ErrorState
            message={
              error.digest
                ? `An unexpected error stopped the page. If it keeps happening, mention reference ${error.digest}.`
                : "An unexpected error stopped the page."
            }
            onRetry={retry}
          />
        </main>
      </body>
    </html>
  );
}
