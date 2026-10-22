import { Edit2, Layers, Plus, Trash2 } from "lucide-react";
import { PROVIDER_TYPE_LABELS, type Provider, type Site } from "@dpm/shared";
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
import { plural } from "../../../utils";

interface SiteListProps {
    sites: Site[];
    providers: Provider[];
    isLoading: boolean;
    onAdd: () => void;
    onEdit: (site: Site) => void;
    onDelete: (site: Site) => void;
}

const providersOf = (site: Site, providers: Provider[]) => providers.filter((p) => site.providerIds.includes(p.id));

/** The sites: groups of providers that give the same answers. */
export const SiteList = ({ sites, providers, isLoading, onAdd, onEdit, onDelete }: SiteListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const matchesSearch = (site: Site, query: string) => {
        const q = query.toLowerCase();
        return [site.name, site.description, ...providersOf(site, providers).map((p) => p.name)].some((text) =>
            text.toLowerCase().includes(q),
        );
    };

    const renderActions = (site: Site) => (
        <DataAction
            rowId={site.id}
            actions={[{ icon: Edit2, onClick: () => onEdit(site), color: "blue", tooltip: "Edit" }]}
            menuEntries={[{ label: "Delete", icon: Trash2, onClick: () => onDelete(site), variant: "danger" }]}
        />
    );

    const columns: DataColumnDef<Site>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (s) => s.name.toLowerCase(),
            list: { label: null },
            render: (s) => (
                <div className="min-w-0">
                    <span className="block text-sm font-medium text-text-primary">{s.name}</span>
                    {s.description && <span className="block truncate text-xs text-text-muted">{s.description}</span>}
                </div>
            ),
        },
        {
            header: "Providers",
            render: (s) => {
                const members = providersOf(s, providers);
                return members.length === 0 ? (
                    <span className="text-sm text-text-muted">None yet</span>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {members.map((p) => (
                            <span key={p.id} title={PROVIDER_TYPE_LABELS[p.type]}>
                                <Badge variant="info">{p.name}</Badge>
                            </span>
                        ))}
                    </div>
                );
            },
        },
        {
            header: "Records",
            sortable: true,
            sortValue: (s) => s.recordCount,
            render: (s) => <span className="text-sm text-text-muted">{plural(s.recordCount, "record")}</span>,
        },
        actionsColumn(renderActions),
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Layers size={18} className="text-text-muted" /> Sites
                </>
            }
            extraActions={
                <Button size="sm" icon={Plus} onClick={onAdd}>
                    Add Site
                </Button>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.sitesView, scope: "local" } }}
            data={sites}
            columns={columns}
            listGroups={listGroups("flex-1 min-w-0")}
            keyField="id"
            isLoading={isLoading}
            loadingMessage="Loading sites…"
            searchable
            searchPlaceholder="Search sites…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No sites match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={Layers}
                    title="No sites yet"
                    description="A site groups the providers that give the same answers, such as “internal” and “external”."
                />
            }
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
