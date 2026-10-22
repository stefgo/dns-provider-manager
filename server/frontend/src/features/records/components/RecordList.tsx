import { Edit2, Globe, Plus, Trash2 } from "lucide-react";
import type { DnsRecord, Site } from "@dpm/shared";
import {
    Badge,
    Button,
    DataAction,
    DataMultiView,
    EmptyState,
    type DataColumnDef,
    PAGE_SIZE,
    listPagination,
    actionsColumn,
    listGroups,
} from "@stefgo/react-ui-components";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

interface RecordListProps {
    records: DnsRecord[];
    sites: Site[];
    isLoading: boolean;
    onAdd: () => void;
    onEdit: (record: DnsRecord) => void;
    onDelete: (record: DnsRecord) => void;
}

/** The names of a record's sites, in the order of the site list. */
const siteNamesOf = (record: DnsRecord, sites: Site[]) =>
    sites.filter((site) => record.siteIds.includes(site.id)).map((site) => site.name);

/**
 * The records, ordered by name so that the records of one name stand together: several A
 * records of round robin, and the same name in two sites with two answers.
 */
export const RecordList = ({ records, sites, isLoading, onAdd, onEdit, onDelete }: RecordListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    // Handed to the view instead of applied in front of it: only then can the view tell a
    // search without a hit from a list with nothing in it.
    const matchesSearch = (record: DnsRecord, query: string) => {
        const q = query.toLowerCase();
        return [record.name, record.value, record.type, record.note, ...siteNamesOf(record, sites)].some((text) =>
            text.toLowerCase().includes(q),
        );
    };

    const renderActions = (record: DnsRecord) => (
        <DataAction
            rowId={record.id}
            actions={[{ icon: Edit2, onClick: () => onEdit(record), color: "blue", tooltip: "Edit" }]}
            menuEntries={[{ label: "Delete", icon: Trash2, onClick: () => onDelete(record), variant: "danger" }]}
        />
    );

    const columns: DataColumnDef<DnsRecord>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (r) => r.name,
            list: { label: null },
            render: (r) => (
                <div className="min-w-0">
                    <span className="block truncate font-mono text-sm font-medium text-text-primary">{r.name}</span>
                    {r.note && <span className="block truncate text-xs text-text-muted">{r.note}</span>}
                </div>
            ),
        },
        {
            header: "Type",
            sortable: true,
            sortValue: (r) => r.type,
            render: (r) => <Badge variant="neutral">{r.type}</Badge>,
        },
        {
            header: "Value",
            sortable: true,
            sortValue: (r) => r.value,
            // An address stays on one line; a long CNAME target may wrap.
            render: (r) => (
                <span className={`font-mono text-sm text-text-primary ${r.type === "CNAME" ? "break-all" : "whitespace-nowrap"}`}>
                    {r.value}
                </span>
            ),
        },
        {
            header: "Sites",
            render: (r) => (
                <div className="flex flex-wrap gap-1">
                    {siteNamesOf(r, sites).map((name) => (
                        <Badge key={name} variant="info">
                            {name}
                        </Badge>
                    ))}
                </div>
            ),
        },
        {
            header: "TTL",
            sortable: true,
            sortValue: (r) => r.ttl ?? 0,
            render: (r) => (
                <span className="whitespace-nowrap text-sm text-text-muted">
                    {r.ttl === null ? "default" : `${r.ttl} s`}
                    {r.proxied && " · proxied"}
                </span>
            ),
        },
        actionsColumn(renderActions),
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Globe size={18} className="text-text-muted" /> Records
                </>
            }
            extraActions={
                <Button size="sm" icon={Plus} onClick={onAdd}>
                    Add Record
                </Button>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.recordsView, scope: "local" } }}
            data={records}
            columns={columns}
            listGroups={listGroups("flex-1 min-w-0")}
            keyField="id"
            isLoading={isLoading}
            loadingMessage="Loading records…"
            searchable
            searchPlaceholder="Search records…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No records match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={Globe}
                    title="No records yet"
                    description={
                        sites.length === 0
                            ? "A record belongs to a site. Add a site first, then the records that go to it."
                            : "Add an A, AAAA or CNAME record and choose the sites it goes to."
                    }
                />
            }
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
