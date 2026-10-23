import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DnsRecord } from "@dpm/shared";
import { Alert, useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteRecord, describeReleaseRecord } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { ROUTES, paths } from "../../../lib/paths";
import { fetchRecordPreview, useDeleteRecord, useRecords, useReleaseRecord, useRemovals } from "../../../queries/records";
import { useProviders } from "../../../queries/providers";
import { useSites } from "../../../queries/sites";
import { plural } from "../../../utils";
import { useLinkActions } from "../hooks/useLinkActions";
import { holdsEntry, providerName, removedAt } from "../lib/recordSync";
import { RecordList } from "./RecordList";
import { RecordSitesDialog } from "./RecordSitesDialog";

/** The page at `/records`. Adding and editing happen on pages of their own. */
export const RecordOverview = () => {
    const navigate = useNavigate();
    const { search } = useLocation();
    const { confirm } = useConfirm();
    const { records, isPending, error } = useRecords();
    // The sites name the badges and the providers the dots; until they are there a record shows ids.
    const { sites } = useSites();
    const { providers } = useProviders();
    const removals = useRemovals();
    const deleteRecord = useDeleteRecord();
    const releaseRecord = useReleaseRecord();
    const actions = useLinkActions();
    const [selected, setSelected] = useState<ReadonlySet<string | number>>(new Set());
    const [changingSites, setChangingSites] = useState<DnsRecord[] | null>(null);

    // The editor closes onto this list, and takes the list's search along to bring it back.
    const open = (pathname: string) => navigate({ pathname, search });

    // Which providers lose the record is the server's to say; without an answer, the question
    // still goes out, without them.
    const requestDelete = async (record: DnsRecord) => {
        const preview = await fetchRecordPreview({ id: record.id, delete: true }).catch(() => null);
        return confirm({
            ...describeDeleteRecord(record, removedAt(preview, providers)),
            onConfirm: () => deleteRecord.mutateAsync(record.id),
        });
    };

    const requestRelease = (record: DnsRecord) =>
        confirm({
            ...describeReleaseRecord(record, record.links.filter(holdsEntry).map((l) => providerName(l.providerId, providers))),
            onConfirm: () => releaseRecord.mutateAsync(record.id),
        });

    if (error) return <QueryError title="Could not load the records" error={error} />;

    return (
        <div className="space-y-4">
            {removals.length > 0 && (
                <Alert tone="warning" title={`${plural(removals.length, "deleted record")} still to be removed`}>
                    <ul className="list-disc pl-5">
                        {removals.map((r) => (
                            <li key={`${r.providerId}:${r.name}:${r.type}:${r.value}`}>
                                {r.name} {r.type} {r.value} at {providerName(r.providerId, providers)}
                                {r.error && <span className="text-text-muted"> — {r.error}</span>}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-1">Removing it is tried again after each reading of the provider.</p>
                </Alert>
            )}
            <RecordList
                records={records}
                sites={sites}
                providers={providers}
                isLoading={isPending}
                onAdd={() => open(ROUTES.recordNew)}
                onEdit={(record) => open(paths.record(record.id))}
                onDelete={requestDelete}
                onRelease={requestRelease}
                onSync={actions.sync}
                onRewrite={actions.rewrite}
                onAccept={actions.accept}
                selected={selected}
                onSelectionChange={setSelected}
                onChangeSites={setChangingSites}
            />
            {changingSites && (
                <RecordSitesDialog
                    records={changingSites}
                    sites={sites}
                    providers={providers}
                    onClose={() => setChangingSites(null)}
                    onDone={() => {
                        setChangingSites(null);
                        setSelected(new Set());
                    }}
                />
            )}
        </div>
    );
};
