import { AlertTriangle, Download, Edit2, Globe, Plus, RefreshCw, Trash2, Unlink, Upload } from "lucide-react";
import type { DnsRecord, Provider, RecordLinkView, Site } from "@dpm/shared";
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
    Tooltip,
} from "@stefgo/react-ui-components";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { hasProblem, holdsEntry, providerName } from "../lib/recordSync";
import { ProviderDots } from "./ProviderDots";

interface RecordListProps {
    records: DnsRecord[];
    sites: Site[];
    providers: Provider[];
    isLoading: boolean;
    /** Show only the records that failed or drifted somewhere. */
    problemsOnly: boolean;
    onProblemsOnly: (on: boolean) => void;
    onAdd: () => void;
    onEdit: (record: DnsRecord) => void;
    onDelete: (record: DnsRecord) => void;
    onRelease: (record: DnsRecord) => void;
    onSync: (record: DnsRecord) => void;
    onRewrite: (record: DnsRecord, link: RecordLinkView) => void;
    onAccept: (record: DnsRecord, link: RecordLinkView) => void;
}

/** The names of a record's sites, in the order of the site list. */
const siteNamesOf = (record: DnsRecord, sites: Site[]) =>
    sites.filter((site) => record.siteIds.includes(site.id)).map((site) => site.name);

/** A record without a site: dpm keeps it and writes it to no provider. */
const isParked = (record: Pick<DnsRecord, "siteIds">) => record.siteIds.length === 0;

/**
 * The records, ordered by name so that the records of one name stand together: several A
 * records of round robin, and the same name in two sites with two answers.
 */
export const RecordList = ({
    records,
    sites,
    providers,
    isLoading,
    problemsOnly,
    onProblemsOnly,
    onAdd,
    onEdit,
    onDelete,
    onRelease,
    onSync,
    onRewrite,
    onAccept,
}: RecordListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    const problems = records.filter(hasProblem).length;
    // A filter of its own, not the search: with it on, an empty list says that nothing failed.
    const shown = problemsOnly ? records.filter(hasProblem) : records;

    // Handed to the view instead of applied in front of it: only then can the view tell a
    // search without a hit from a list with nothing in it.
    const matchesSearch = (record: DnsRecord, query: string) => {
        const q = query.toLowerCase();
        const parked = isParked(record) ? ["parked"] : [];
        return [record.name, record.value, record.type, record.note, ...siteNamesOf(record, sites), ...parked].some((text) =>
            text.toLowerCase().includes(q),
        );
    };

    const renderActions = (record: DnsRecord) => {
        const drifted = record.links.filter((l) => l.status === "drift" || l.status === "missing");
        return (
            <DataAction
                rowId={record.id}
                actions={[{ icon: Edit2, onClick: () => onEdit(record), color: "blue", tooltip: "Edit" }]}
                menuEntries={[
                    { label: "Write again", icon: RefreshCw, onClick: () => onSync(record), disabled: record.links.length === 0 },
                    ...drifted.flatMap((link) => {
                        const name = providerName(link.providerId, providers);
                        return [
                            { label: `Write again to ${name}`, icon: Upload, onClick: () => onRewrite(record, link) },
                            { label: `Take over from ${name}`, icon: Download, onClick: () => onAccept(record, link) },
                        ];
                    }),
                    // With no entry at any provider, releasing would be deleting.
                    { label: "Release", icon: Unlink, onClick: () => onRelease(record), disabled: !record.links.some(holdsEntry) },
                    { label: "Delete", icon: Trash2, onClick: () => onDelete(record), variant: "danger" as const },
                ]}
            />
        );
    };

    const columns: DataColumnDef<DnsRecord>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (r) => r.name,
            list: { label: null },
            render: (r) => (
                <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">{r.name}</span>
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
                <span className={`text-sm text-text-primary ${r.type === "CNAME" ? "break-all" : "whitespace-nowrap"}`}>
                    {r.value}
                </span>
            ),
        },
        {
            header: "Sites",
            render: (r) => (
                <div className="flex flex-wrap gap-1">
                    {isParked(r) && (
                        <Tooltip content="No site: written to no provider">
                            <span tabIndex={0} className="inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                <Badge variant="warning">Parked</Badge>
                            </span>
                        </Tooltip>
                    )}
                    {siteNamesOf(r, sites).map((name) => (
                        <Badge key={name} variant="info">
                            {name}
                        </Badge>
                    ))}
                </div>
            ),
        },
        {
            header: "Providers",
            sortable: true,
            // Problems first when sorted: they are what the column is looked at for.
            sortValue: (r) => (hasProblem(r) ? 0 : 1),
            render: (r) => <ProviderDots record={r} providers={providers} />,
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
                <>
                    {(problems > 0 || problemsOnly) && (
                        <Button
                            size="sm"
                            variant={problemsOnly ? "primary" : "secondary"}
                            icon={AlertTriangle}
                            onClick={() => onProblemsOnly(!problemsOnly)}
                            aria-pressed={problemsOnly}
                        >
                            Problems ({problems})
                        </Button>
                    )}
                    <Button size="sm" icon={Plus} onClick={onAdd}>
                        Add Record
                    </Button>
                </>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.recordsView, scope: "local" } }}
            data={shown}
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
                problemsOnly ? (
                    <EmptyState icon={Globe} title="No problems" description="Every record is where dpm wrote it." />
                ) : (
                    <EmptyState
                        icon={Globe}
                        title="No records yet"
                        description={
                            sites.length === 0
                                ? "A record belongs to a site. Add a site first, then the records that go to it."
                                : "Add an A, AAAA or CNAME record and choose the sites it goes to."
                        }
                    />
                )
            }
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
