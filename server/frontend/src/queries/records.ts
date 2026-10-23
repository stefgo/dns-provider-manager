import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
    PendingRemovalListSchema,
    RecordListSchema,
    RecordPreviewSchema,
    RecordViewSchema,
    type DnsRecord,
    type PendingRemoval,
    type RecordInput,
    type RecordPreviewRequest,
} from "@dpm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { invalidateDns } from "./dns";

const NO_RECORDS: DnsRecord[] = [];
const NO_REMOVALS: PendingRemoval[] = [];

/**
 * The records, with where each stands at its providers. The server says when that changed
 * (`RECORDS_UPDATE`), and the list is read again; a change made here is read back at once.
 */
export const recordListOptions = queryOptions({
    queryKey: queryKeys.records.list(),
    queryFn: () => api.get("/api/v1/records", RecordListSchema, { fallback: "Failed to fetch the records" }),
});

/**
 * `isPending` until the list has arrived once; an empty list before that says nothing.
 * `error` is why there is no list.
 */
export function useRecords() {
    const { data, isPending, error } = useQuery(recordListOptions);
    return { records: data ?? NO_RECORDS, isPending, error: data === undefined ? error : null };
}

/** Creates a record, or changes the one `id` names. PUT takes the whole record. */
export function useSaveRecord() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, input }: { id?: string; input: RecordInput }) =>
            id
                ? api.put(`/api/v1/records/${id}`, input, RecordViewSchema)
                : api.post("/api/v1/records", input, RecordViewSchema),
        onSettled: () => invalidateDns(queryClient),
    });
}

export function useDeleteRecord() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.delete(`/api/v1/records/${id}`, { fallback: "Failed to delete the record" }),
        onSettled: () => invalidateDns(queryClient),
    });
}

/**
 * Deleted records a provider still holds. Read with the records, and again whenever they
 * are (`queryKeys.records.all`).
 */
export function useRemovals() {
    const { data } = useQuery({
        queryKey: queryKeys.records.removals(),
        queryFn: () => api.get("/api/v1/records/removals", PendingRemovalListSchema, { fallback: "Failed to fetch the pending removals" }),
    });
    return data ?? NO_REMOVALS;
}

/**
 * What saving the editor's record -- or deleting a stored one -- would do at each provider.
 * Asked again whenever the request changes; null asks nothing. The last answer stays on
 * screen while the next one is under way, so the list does not flicker as the user types.
 */
export function useRecordPreview(request: RecordPreviewRequest | null) {
    return useQuery({
        queryKey: queryKeys.records.preview(request),
        queryFn: () => api.post("/api/v1/records/preview", request, RecordPreviewSchema, { fallback: "Failed to preview the record" }),
        enabled: request !== null,
        placeholderData: keepPreviousData,
        staleTime: 0,
        gcTime: 0,
    });
}

/** Asks the preview once, for a confirmation -- not a query the page keeps. */
export const fetchRecordPreview = (request: RecordPreviewRequest) =>
    api.post("/api/v1/records/preview", request, RecordPreviewSchema, { fallback: "Failed to preview the record" });

/**
 * The record's own actions at its providers: write it again everywhere (`sync`), write dpm's
 * value over what one provider holds (`rewrite`), or take that over (`accept`). Each answers
 * the record as it is now.
 */
export function useRecordAction() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, action, providerId }: { id: string; action: "sync" | "rewrite" | "accept"; providerId?: string }) => {
            if (action === "sync") return api.post(`/api/v1/records/${id}/sync`, {}, RecordViewSchema);
            if (action === "rewrite") return api.post(`/api/v1/records/${id}/links/${providerId}/rewrite`, {}, RecordViewSchema);
            return api
                .post(`/api/v1/records/${id}/links/${providerId}/accept`, {}, z.object({ record: RecordViewSchema }))
                .then((answer) => answer.record);
        },
        onSettled: () => invalidateDns(queryClient),
    });
}
