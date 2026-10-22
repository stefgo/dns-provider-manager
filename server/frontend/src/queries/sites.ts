import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SiteListSchema, SiteViewSchema, type Site, type SiteInput } from "@dpm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { invalidateDns } from "./dns";

const NO_SITES: Site[] = [];

/**
 * The sites. Nothing broadcasts a change to them, so the list goes stale by age and is read
 * again by whatever opens it after that -- and at once after a change made here.
 */
export const siteListOptions = queryOptions({
    queryKey: queryKeys.sites.list(),
    queryFn: () => api.get("/api/v1/sites", SiteListSchema, { fallback: "Failed to fetch the sites" }),
});

/**
 * `isPending` until the list has arrived once; an empty list before that says nothing.
 * `error` is why there is no list.
 */
export function useSites() {
    const { data, isPending, error } = useQuery(siteListOptions);
    return { sites: data ?? NO_SITES, isPending, error: data === undefined ? error : null };
}

/** Creates a site, or changes the one `id` names. PUT takes the whole site. */
export function useSaveSite() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, input }: { id?: string; input: SiteInput }) =>
            id
                ? api.put(`/api/v1/sites/${id}`, input, SiteViewSchema)
                : api.post("/api/v1/sites", input, SiteViewSchema),
        onSettled: () => invalidateDns(queryClient),
    });
}

export function useDeleteSite() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/sites/${id}`, { fallback: "Failed to delete the site" }),
        onSettled: () => invalidateDns(queryClient),
    });
}
