"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  apiErrorForReport,
  isUnexpectedApiError,
  reportError,
  statusOf,
  type ErrorSource,
} from "@/lib/error-reporter";

// Failed API calls the user did not cause: a 5xx, or no answer at all. A 4xx is
// the normal flow (validation, a conflict, an expired token, the rate limit) and
// the screen that made the call already shows it. Only the operation name is
// taken from the query key; the rest of it holds what the user typed.
function reportApiFailure(
  source: ErrorSource,
  error: unknown,
  key: readonly unknown[] | undefined,
) {
  if (!isUnexpectedApiError(error)) {
    return;
  }
  // The generated client's query keys start with { _id: "<operation>", ... }.
  const first = key?.[0] as Record<string, unknown> | undefined;
  const id = typeof first === "object" && first !== null ? first["_id"] : undefined;
  const operation = typeof id === "string" ? id : undefined;
  void reportError(apiErrorForReport(error), {
    source,
    route: window.location.pathname,
    status: statusOf(error),
    operation,
  });
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => reportApiFailure("query", error, query.queryKey),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        reportApiFailure("mutation", error, mutation.options.mutationKey),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser tab, created once and never shared across requests.
  const [queryClient] = useState(makeQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
