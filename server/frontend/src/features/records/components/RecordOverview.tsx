import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DnsRecord } from "@dpm/shared";
import { Alert, useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteRecord } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { ROUTES, paths } from "../../../lib/paths";
import { fetchRecordPreview, useDeleteRecord, useRecords, useRemovals } from "../../../queries/records";
import { useProviders } from "../../../queries/providers";
import { useSites } from "../../../queries/sites";
import { plural } from "../../../utils";
import { useLinkActions } from "../hooks/useLinkActions";
import { providerName, removedAt } from "../lib/recordSync";
import { RecordList } from "./RecordList";

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
    const actions = useLinkActions();
    const [problemsOnly, setProblemsOnly] = useState(false);

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
                problemsOnly={problemsOnly}
                onProblemsOnly={setProblemsOnly}
                onAdd={() => open(ROUTES.recordNew)}
                onEdit={(record) => open(paths.record(record.id))}
                onDelete={requestDelete}
                onSync={actions.sync}
                onRewrite={actions.rewrite}
                onAccept={actions.accept}
            />
        </div>
    );
};
