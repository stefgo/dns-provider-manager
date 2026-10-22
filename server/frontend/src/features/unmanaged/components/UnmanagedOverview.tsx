import { useState } from "react";
import { Download, Inbox, RefreshCw } from "lucide-react";
import type { UnmanagedEntry } from "@dpm/shared";
import {
    Alert,
    Badge,
    Button,
    DataMultiView,
    EmptyState,
    Select,
    type DataColumnDef,
    PAGE_SIZE,
    listPagination,
    listGroups,
    useToast,
} from "@stefgo/react-ui-components";
import { QueryError } from "../../../components/QueryError";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { STORAGE_KEYS } from "../../../lib/storageKeys";
import { useUnmanaged } from "../../../queries/unmanaged";
import { readAllProviders, useProviders } from "../../../queries/providers";
import { useSites } from "../../../queries/sites";
import { describeFailure, plural } from "../../../utils";
import { entriesOf, entryKey } from "../lib/adopt";
import { AdoptDialog } from "./AdoptDialog";

const ALL = "";

/**
 * The page at `/unmanaged`: what the providers hold and dpm does not manage there. Entries
 * are taken over into a site, picked ones or -- with nothing picked -- what the list shows.
 * Nothing here writes to a provider.
 */
export const UnmanagedOverview = () => {
    const { readings, entries, isPending, error } = useUnmanaged();
    const { providers } = useProviders();
    const { sites } = useSites();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    const [providerFilter, setProviderFilter] = useState(ALL);
    const [selected, setSelected] = useState<ReadonlySet<string | number>>(new Set());
    const [adopting, setAdopting] = useState<UnmanagedEntry[] | null>(null);
    const [reading, setReading] = useState(false);
    const { show } = useToast();

    const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

    const matchesSearch = (entry: UnmanagedEntry, query: string) => {
        const q = query.toLowerCase();
        return [entry.name, entry.value, entry.type, entry.zone ?? "", providerName(entry.providerId)].some((text) =>
            text.toLowerCase().includes(q),
        );
    };

    // The provider filter is no search: applied in front, and the empty message says so.
    const filtered = providerFilter === ALL ? entries : entries.filter((e) => e.providerId === providerFilter);
    const shown = searchQuery ? filtered.filter((e) => matchesSearch(e, searchQuery)) : filtered;

    const readAll = async () => {
        setReading(true);
        try {
            const result = await readAllProviders();
            if (result.failed) {
                show({ variant: "warning", title: `${plural(result.failed, "provider")} could not be read`, duration: 0 });
            }
        } catch (err) {
            show({ variant: "error", ...describeFailure("Could not read the providers", err), duration: 0 });
        } finally {
            setReading(false);
        }
    };

    if (error) return <QueryError title="Could not load the unmanaged records" error={error} />;

    const failing = readings.filter((r) => r.error !== null);
    const readable = providers.filter((p) => p.readable);

    const columns: DataColumnDef<UnmanagedEntry>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (e) => e.name,
            list: { label: null },
            render: (e) => (
                <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">{e.name}</span>
                    {e.problem && <span className="block text-xs text-warning">{e.problem}</span>}
                </div>
            ),
        },
        {
            header: "Type",
            sortable: true,
            sortValue: (e) => e.type,
            render: (e) => <Badge variant="neutral">{e.type}</Badge>,
        },
        {
            header: "Value",
            sortable: true,
            sortValue: (e) => e.value,
            // An address stays on one line; a long CNAME target may wrap.
            render: (e) => (
                <span className={`text-sm text-text-primary ${e.type === "CNAME" ? "break-all" : "whitespace-nowrap"}`}>
                    {e.value}
                </span>
            ),
        },
        {
            header: "Provider",
            sortable: true,
            sortValue: (e) => providerName(e.providerId),
            render: (e) => (
                <span className="text-sm text-text-primary">
                    {providerName(e.providerId)}
                    {e.zone && <span className="text-text-muted"> ({e.zone})</span>}
                </span>
            ),
        },
        {
            header: "TTL",
            render: (e) => (
                <span className="whitespace-nowrap text-sm text-text-muted">
                    {e.ttl === null ? "default" : `${e.ttl} s`}
                    {e.proxied && " · proxied"}
                </span>
            ),
        },
        {
            header: "In dpm",
            table: { headerClassName: "whitespace-nowrap" },
            render: (e) =>
                e.recordId ? (
                    <span title="dpm has this record in other sites; adopting gives it the site">
                        <Badge variant="info">other sites</Badge>
                    </span>
                ) : (
                    <span className="text-sm text-text-muted">–</span>
                ),
        },
    ];

    const adoptTarget = (picked: ReadonlySet<string | number>) =>
        (picked.size > 0 ? entriesOf(shown, picked) : shown).filter((e) => e.problem === null);

    return (
        <div className="space-y-4">
            {failing.map((r) => (
                <Alert key={r.providerId} title={`${providerName(r.providerId)} cannot be read`}>
                    {r.error}
                    {r.readAt && " What it held at its last reading is shown."}
                </Alert>
            ))}

            <DataMultiView
                title={
                    <>
                        <Inbox size={18} className="text-text-muted" /> Unmanaged
                    </>
                }
                extraActions={(picked) => {
                    const target = adoptTarget(picked);
                    return (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={readAll} isLoading={reading}>
                                Read Now
                            </Button>
                            <Button size="sm" icon={Download} disabled={target.length === 0} onClick={() => setAdopting(target)}>
                                Adopt {picked.size > 0 ? `(${target.length})` : target.length > 0 ? `all ${target.length}` : ""}
                            </Button>
                        </div>
                    );
                }}
                sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
                viewMode={{ persist: { key: STORAGE_KEYS.unmanagedView, scope: "local" } }}
                data={filtered}
                columns={columns}
                listGroups={listGroups("flex-1 min-w-0")}
                keyField={entryKey}
                isLoading={isPending}
                loadingMessage="Reading what the providers hold…"
                selection={{
                    value: selected,
                    onChange: setSelected,
                    isSelectable: (e) => e.problem === null,
                    rowLabel: (e) => `Select ${e.name} ${e.type} ${e.value}`,
                }}
                searchable
                searchPlaceholder="Search unmanaged records…"
                search={{ value: searchQuery, onChange: setSearchQuery }}
                searchFilter={matchesSearch}
                searchActions={
                    readable.length > 1 && (
                        <Select
                            aria-label="Filter by provider"
                            fullWidth={false}
                            value={providerFilter}
                            onChange={(e) => setProviderFilter(e.target.value)}
                            options={[{ value: ALL, label: "All providers" }, ...readable.map((p) => ({ value: p.id, label: p.name }))]}
                        />
                    )
                }
                noResultsMessage={`No unmanaged records match “${searchQuery}”.`}
                emptyMessage={
                    readable.length === 0 ? (
                        <EmptyState
                            icon={Inbox}
                            title="No provider to read"
                            description="Add a provider: what it holds and dpm does not manage is listed here, to be adopted."
                        />
                    ) : entries.length === 0 ? (
                        <EmptyState
                            icon={Inbox}
                            title="Nothing unmanaged"
                            description="Every A, AAAA and CNAME record the providers hold is managed by dpm."
                        />
                    ) : (
                        "No unmanaged records at this provider."
                    )
                }
                pagination={listPagination(PAGE_SIZE.page)}
            />

            {adopting && (
                <AdoptDialog
                    entries={adopting}
                    sites={sites}
                    providers={providers}
                    onClose={() => setAdopting(null)}
                    onDone={() => {
                        setAdopting(null);
                        setSelected(new Set());
                    }}
                />
            )}
        </div>
    );
};
