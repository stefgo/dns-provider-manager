import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RecordListSchema, RecordViewSchema, type DnsRecord, type RecordInput } from "@dpm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { invalidateDns } from "./dns";

const NO_RECORDS: DnsRecord[] = [];

/**
 * The records. Nothing broadcasts a change to them, so the list goes stale by age and is read
 * again by whatever opens it after that -- and at once after a change made here.
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
