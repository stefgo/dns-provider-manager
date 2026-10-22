import { Edit2, Plus, Server, Trash2 } from "lucide-react";
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
import { providerTarget } from "../lib/providerTarget";

interface ProviderListProps {
    providers: Provider[];
    sites: Site[];
    isLoading: boolean;
    onAdd: () => void;
    onEdit: (provider: Provider) => void;
    onDelete: (provider: Provider) => void;
}

const sitesOf = (provider: Provider, sites: Site[]) => sites.filter((s) => provider.siteIds.includes(s.id));

/** The providers: one access each to a DNS server dpm writes to. */
export const ProviderList = ({ providers, sites, isLoading, onAdd, onEdit, onDelete }: ProviderListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const matchesSearch = (provider: Provider, query: string) => {
        const q = query.toLowerCase();
        return [provider.name, PROVIDER_TYPE_LABELS[provider.type], providerTarget(provider), ...sitesOf(provider, sites).map((s) => s.name)].some(
            (text) => text.toLowerCase().includes(q),
        );
    };

    const renderActions = (provider: Provider) => (
        <DataAction
            rowId={provider.id}
            actions={[{ icon: Edit2, onClick: () => onEdit(provider), color: "blue", tooltip: "Edit" }]}
            menuEntries={[{ label: "Delete", icon: Trash2, onClick: () => onDelete(provider), variant: "danger" }]}
        />
    );

    const columns: DataColumnDef<Provider>[] = [
        {
            header: "Name",
            sortable: true,
            sortValue: (p) => p.name.toLowerCase(),
            list: { label: null },
            render: (p) => <span className="text-sm font-medium text-text-primary">{p.name}</span>,
        },
        {
            header: "Type",
            sortable: true,
            sortValue: (p) => PROVIDER_TYPE_LABELS[p.type],
            render: (p) => <Badge variant="neutral">{PROVIDER_TYPE_LABELS[p.type]}</Badge>,
        },
        {
            header: "Target",
            render: (p) => (
                <span className="block max-w-md truncate text-sm text-text-muted" title={providerTarget(p)}>
                    {providerTarget(p)}
                </span>
            ),
        },
        {
            header: "Sites",
            render: (p) => {
                const member = sitesOf(p, sites);
                return member.length === 0 ? (
                    <span className="text-sm text-text-muted">None</span>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {member.map((s) => (
                            <Badge key={s.id} variant="info">
                                {s.name}
                            </Badge>
                        ))}
                    </div>
                );
            },
        },
        actionsColumn(renderActions),
    ];

    return (
        <DataMultiView
            title={
                <>
                    <Server size={18} className="text-text-muted" /> Providers
                </>
            }
            extraActions={
                <Button size="sm" icon={Plus} onClick={onAdd}>
                    Add Provider
                </Button>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: STORAGE_KEYS.providersView, scope: "local" } }}
            data={providers}
            columns={columns}
            listGroups={listGroups("flex-1 min-w-0")}
            keyField="id"
            isLoading={isLoading}
            loadingMessage="Loading providers…"
            searchable
            searchPlaceholder="Search providers…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            noResultsMessage={`No providers match “${searchQuery}”.`}
            emptyMessage={
                <EmptyState
                    icon={Server}
                    title="No providers yet"
                    description="Add the DNS servers dpm writes to: a Cloudflare API token, an AdGuard Home instance, a Samba AD domain."
                />
            }
            pagination={listPagination(PAGE_SIZE.page)}
        />
    );
};
