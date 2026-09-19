"use client";

import { useQuery } from "@tanstack/react-query";

import { ErrorState, LoadingState } from "@/components/states";
import { getMeOptions } from "@/lib/api/gen/@tanstack/react-query.gen";
import { describeProblem } from "@/lib/api/problem";

const API_UNREACHABLE = "The API could not be reached. Check that it is running and try again.";

export function MeCard() {
  const me = useQuery(getMeOptions());

  return (
    <section aria-labelledby="me-heading" className="mt-8 max-w-xl rounded-lg border bg-card p-6">
      <h2 id="me-heading" className="text-sm font-semibold">
        Your identity, as seen by the API
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Loaded from <code className="font-mono text-xs">GET /api/v1/me</code> on the Go API with a
        short-lived token.
      </p>

      <div className="mt-5" aria-live="polite">
        {me.isPending && <LoadingState />}

        {me.isError && (
          <ErrorState
            message={describeProblem(me.error, API_UNREACHABLE)}
            onRetry={() => me.refetch()}
            retrying={me.isFetching}
          />
        )}

        {me.isSuccess && (
          <dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
            <dt className="text-muted-foreground">ID</dt>
            <dd className="font-mono text-xs break-all">{me.data.id}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd>{me.data.email}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{me.data.name}</dd>
          </dl>
        )}
      </div>
    </section>
  );
}
