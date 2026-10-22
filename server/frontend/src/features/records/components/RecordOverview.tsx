import { useLocation, useNavigate } from "react-router-dom";
import type { DnsRecord } from "@dpm/shared";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteRecord } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { ROUTES, paths } from "../../../lib/paths";
import { useDeleteRecord, useRecords } from "../../../queries/records";
import { useSites } from "../../../queries/sites";
import { RecordList } from "./RecordList";

/** The page at `/records`. Adding and editing happen on pages of their own. */
export const RecordOverview = () => {
    const navigate = useNavigate();
    const { search } = useLocation();
    const { confirm } = useConfirm();
    const { records, isPending, error } = useRecords();
    // The sites name the badges; until they are there a record shows none.
    const { sites } = useSites();
    const deleteRecord = useDeleteRecord();

    // The editor closes onto this list, and takes the list's search along to bring it back.
    const open = (pathname: string) => navigate({ pathname, search });

    const requestDelete = (record: DnsRecord) =>
        confirm({ ...describeDeleteRecord(record), onConfirm: () => deleteRecord.mutateAsync(record.id) });

    if (error) return <QueryError title="Could not load the records" error={error} />;

    return (
        <RecordList
            records={records}
            sites={sites}
            isLoading={isPending}
            onAdd={() => open(ROUTES.recordNew)}
            onEdit={(record) => open(paths.record(record.id))}
            onDelete={requestDelete}
        />
    );
};
