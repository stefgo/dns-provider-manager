import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProviderListSchema, ProviderViewSchema, type Provider, type ProviderInput } from "@dpm/shared";
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
