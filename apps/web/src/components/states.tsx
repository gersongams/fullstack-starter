import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Nothing here yet: says so and offers the action that fills it. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 border-y border-dashed py-10">
      <div className="space-y-1">
        <h2 className="text-base font-medium">{title}</h2>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** A request failed: says what happened and lets the user run it again. */
export function ErrorState({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 border-y border-dashed py-10">
      <p className="max-w-prose text-sm text-destructive">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}

/** Placeholder lines while a request is pending. */
export function LoadingState({ rows = 3, label = "Loading…" }: { rows?: number; label?: string }) {
  const widths = ["w-2/3", "w-1/2", "w-3/5", "w-1/3"];
  return (
    <div className="space-y-3 py-2" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={`h-5 ${widths[index % widths.length]}`} />
      ))}
    </div>
  );
}
