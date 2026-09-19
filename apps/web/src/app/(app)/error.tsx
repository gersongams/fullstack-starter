"use client";

import { useEffect } from "react";

import { PageHeader } from "@/components/app-shell";
import { ErrorState } from "@/components/states";
import { reportError } from "@/lib/error-reporter";

// Catches a render error in any signed-in page. The shell (navigation, account
// menu) stays, since the boundary sits inside the (app) layout, so the user can
// retry or go somewhere else.
export default function AppError({
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
    <>
      <PageHeader title="Something went wrong" description="This page could not be shown." />
      <ErrorState
        message={
          error.digest
            ? `An unexpected error stopped this page. If it keeps happening, mention reference ${error.digest}.`
            : "An unexpected error stopped this page."
        }
        onRetry={retry}
      />
    </>
  );
}
