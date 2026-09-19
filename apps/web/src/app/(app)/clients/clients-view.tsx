"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listClientsInfiniteOptions } from "@/lib/api/gen/@tanstack/react-query.gen";
import type { Client } from "@/lib/api/gen/types.gen";
import { describeProblem } from "@/lib/api/problem";

import { ClientFormDialog } from "./client-form-dialog";
import { ClientsTable } from "./clients-table";
import { DeleteClientDialog } from "./delete-client-dialog";
import { PAGE_SIZE } from "./queries";

const SEARCH_DELAY_MS = 300;

type Editing = { mode: "create" } | { mode: "edit"; client: Client };

/** The list query for one search term. */
function useClientList(term: string) {
  return useInfiniteQuery({
    ...listClientsInfiniteOptions({ query: { limit: PAGE_SIZE, ...(term ? { q: term } : {}) } }),
    initialPageParam: {},
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    // Keep the rows on screen while the next search term loads.
    placeholderData: keepPreviousData,
  });
}

export function ClientsView() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing>();
  const [deleting, setDeleting] = useState<Client>();
  const term = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const list = useClientList(term);

  const addButton = (
    <Button type="button" onClick={() => setEditing({ mode: "create" })}>
      Add client
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Clients"
        description="The people and companies you work with."
        action={addButton}
      />

      <div className="mt-6">
        <label htmlFor="client-search" className="sr-only">
          Search clients by name
        </label>
        <Input
          id="client-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name"
          className="max-w-xs"
        />
      </div>

      <div className="mt-4" aria-live="polite">
        <ClientsResults
          list={list}
          term={term}
          addAction={addButton}
          onClearSearch={() => setSearch("")}
          onEdit={(client) => setEditing({ mode: "edit", client })}
          onDelete={setDeleting}
        />
      </div>

      {editing && (
        <ClientFormDialog
          key={editing.mode === "edit" ? editing.client.id : "create"}
          client={editing.mode === "edit" ? editing.client : undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
      {deleting && <DeleteClientDialog client={deleting} onClose={() => setDeleting(undefined)} />}
    </>
  );
}

/** One state at a time: loading, failed, empty, no match, or the rows. */
function ClientsResults({
  list,
  term,
  addAction,
  onClearSearch,
  onEdit,
  onDelete,
}: {
  list: ReturnType<typeof useClientList>;
  term: string;
  addAction: ReactNode;
  onClearSearch: () => void;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
}) {
  if (list.isPending) {
    return <LoadingState rows={4} label="Loading clients…" />;
  }
  if (list.isError) {
    return (
      <ErrorState
        message={describeProblem(list.error, "Your clients could not be loaded.")}
        onRetry={() => list.refetch()}
        retrying={list.isFetching}
      />
    );
  }

  const rows = list.data.pages.flatMap((page) => page.items ?? []);
  if (rows.length === 0 && term === "") {
    return (
      <EmptyState
        title="No clients yet"
        description="Add the first one to start keeping their records here."
        action={addAction}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No client matches “${term}”`}
        description="Search looks at names only. Check the spelling or clear the search."
        action={
          <Button type="button" variant="outline" size="sm" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ClientsTable clients={rows} onEdit={onEdit} onDelete={onDelete} />
      {list.hasNextPage && (
        <div className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {list.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}
