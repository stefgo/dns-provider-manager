import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";

/**
 * Records, sites and providers name each other: a site counts its records and lists its
 * providers, a provider lists its sites, and what is unmanaged depends on all three. A
 * change to one of them is read back into all, so no list shows what the change made untrue.
 *
 * Also after a refusal: the lists then show what the server holds.
 */
export const invalidateDns = (queryClient: QueryClient) =>
    Promise.all(
        [queryKeys.records.all, queryKeys.sites.all, queryKeys.providers.all, queryKeys.unmanaged.all].map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
        ),
    );
