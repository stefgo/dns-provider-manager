import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdoptResultSchema, UnmanagedResponseSchema, type AdoptRequest } from "@dpm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { invalidateDns } from "./dns";

/**
 * What the providers hold and dpm does not manage, and how each provider's reading went.
 * The server says on the socket whenever it read a provider; the entry is read again then.
 */
export const unmanagedOptions = queryOptions({
    queryKey: queryKeys.unmanaged.list(),
    queryFn: () => api.get("/api/v1/unmanaged", UnmanagedResponseSchema, { fallback: "Failed to fetch the unmanaged records" }),
});

const NOTHING = { readings: [], entries: [] };

export function useUnmanaged() {
    const { data, isPending, error } = useQuery(unmanagedOptions);
    return { ...(data ?? NOTHING), isPending, error: data === undefined ? error : null };
}

/** Takes entries over into a site. What was refused is part of the answer, not an error. */
export function useAdopt() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (request: AdoptRequest) => api.post("/api/v1/unmanaged/adopt", request, AdoptResultSchema),
        onSettled: () => invalidateDns(queryClient),
    });
}
