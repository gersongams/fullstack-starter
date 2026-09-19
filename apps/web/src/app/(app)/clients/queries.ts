import type { QueryClient } from "@tanstack/react-query";

export const PAGE_SIZE = 20;

/**
 * Cache policy for clients: invalidate, don't patch. After any mutation every
 * cached list (each search term has its own) is refetched, so ordering, search
 * matches and cursors always come from the server.
 */
export function invalidateClientLists(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [key] = query.queryKey;
      // oxlint-disable-next-line no-underscore-dangle -- `_id` is the generated client's key shape.
      return typeof key === "object" && key !== null && "_id" in key && key._id === "listClients";
    },
  });
}
