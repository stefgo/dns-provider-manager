import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ManualRunResultSchema,
    ProviderListSchema,
    ProviderTestResultSchema,
    ProviderViewSchema,
    ReadingViewSchema,
    type Provider,
    type ProviderInput,
    type ProviderTestRequest,
} from "@dpm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { invalidateDns } from "./dns";

const NO_PROVIDERS: Provider[] = [];

/**
 * The providers. Nothing broadcasts a change to them, so the list goes stale by age and is read
 * again by whatever opens it after that -- and at once after a change made here.
 */
export const providerListOptions = queryOptions({
    queryKey: queryKeys.providers.list(),
    queryFn: () => api.get("/api/v1/providers", ProviderListSchema, { fallback: "Failed to fetch the providers" }),
});

/**
 * `isPending` until the list has arrived once; an empty list before that says nothing.
 * `error` is why there is no list.
 */
export function useProviders() {
    const { data, isPending, error } = useQuery(providerListOptions);
    return { providers: data ?? NO_PROVIDERS, isPending, error: data === undefined ? error : null };
}

/** Creates a provider, or changes the one `id` names. PUT takes the whole provider. */
export function useSaveProvider() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, input }: { id?: string; input: ProviderInput }) =>
            id
                ? api.put(`/api/v1/providers/${id}`, input, ProviderViewSchema)
                : api.post("/api/v1/providers", input, ProviderViewSchema),
        onSettled: () => invalidateDns(queryClient),
    });
}

export function useDeleteProvider() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/providers/${id}`, { fallback: "Failed to delete the provider" }),
        onSettled: () => invalidateDns(queryClient),
    });
}

/** Whether a provider as the editor holds it answers. Not cached: it is asked now or not at all. */
export const testProvider = (request: ProviderTestRequest) =>
    api.post("/api/v1/providers/test", request, ProviderTestResultSchema, { fallback: "The test could not be run" });

/**
 * Reads one provider now. What it found arrives through the cache: the server says on the
 * socket that it read, and the lists are read again.
 */
export const readProvider = (id: string) =>
    api.post(`/api/v1/providers/${id}/read`, undefined, ReadingViewSchema, { fallback: "The provider could not be read" });

/** Reads every provider now, as a run of the scheduler. */
export const readAllProviders = () =>
    api.post("/api/v1/providers/read", undefined, ManualRunResultSchema, { fallback: "The providers could not be read" });
