import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ClusterPreviewSchema,
    ClusterStatusListSchema,
    ClusterStatusSchema,
    ManualRunResultSchema,
    type ClusterStatus,
    type ProviderTestRequest,
} from "@dpm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

const NO_STATUSES: ClusterStatus[] = [];

/**
 * How every AdGuard Home cluster keeps its nodes alike, area by area. One list for all of
 * them -- the dashboard's findings and the provider list read it as well as a cluster's page.
 * `CLUSTER_UPDATE` reads it anew after every run.
 */
export const clusterListOptions = queryOptions({
    queryKey: queryKeys.clusters.list(),
    queryFn: () => api.get("/api/v1/clusters", ClusterStatusListSchema, { fallback: "Failed to fetch the clusters" }),
});

/** `isPending` until the list has arrived once; `error` is why there is none. */
export function useClusters() {
    const { data, isPending, error } = useQuery(clusterListOptions);
    return { statuses: data ?? NO_STATUSES, isPending, error: data === undefined ? error : null };
}

/** "Sync now": keeps one cluster alike and answers how it stands afterwards. */
export function useRunCluster() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (providerId: string) =>
            api.post(`/api/v1/providers/${providerId}/cluster/run`, undefined, ClusterStatusSchema, { fallback: "The cluster could not be kept alike" }),
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.clusters.all });
            void queryClient.invalidateQueries({ queryKey: queryKeys.providers.all });
        },
    });
}

/**
 * What saving a cluster as the editor holds it would write to its nodes, read from them now.
 * Not cached: it is asked right before saving or not at all.
 */
export const fetchClusterPreview = (request: ProviderTestRequest) =>
    api.post("/api/v1/providers/cluster/preview", request, ClusterPreviewSchema, { fallback: "The nodes could not be read" });

/** Every cluster now, as a run of the scheduler: the settings page's "Run now". */
export const runAllClusters = () =>
    api.post("/api/v1/clusters/run", undefined, ManualRunResultSchema, { fallback: "The clusters could not be kept alike" });
