import { Link } from "react-router-dom";
import { PROVIDER_TYPE_LABELS, type Provider, type Site } from "@dpm/shared";
import { InfoGrid, InfoRow, MultiSelectField } from "../../../components/MultiSelectField";
import { ROUTES } from "../../../lib/paths";
import { plural } from "../../../utils";

/** What a site's row opens to: the providers its records go to. */
const SiteInfo = ({ site, providers }: { site: Site; providers: Provider[] }) => {
    const members = providers.filter((p) => site.providerIds.includes(p.id));
    return (
        <InfoGrid>
            {site.description && <InfoRow label="Description">{site.description}</InfoRow>}
            <InfoRow label="Providers">
                {members.length === 0
                    ? "None yet"
                    : members.map((p) => `${p.name} (${PROVIDER_TYPE_LABELS[p.type]})`).join(", ")}
            </InfoRow>
            <InfoRow label="Records">{plural(site.recordCount, "record")}</InfoRow>
        </InfoGrid>
    );
};

const SiteName = ({ site }: { site: Site }) => (
    <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-sm font-medium text-text-primary">{site.name}</span>
        {site.description && <span className="truncate text-xs text-text-muted">{site.description}</span>}
    </div>
);

interface RecordSiteSelectProps {
    sites: Site[];
    providers: Provider[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    isSelecting: boolean;
    onSetIsSelecting: (selecting: boolean) => void;
    error?: string;
}

/** The sites of a record, picked the way a site picks its providers. */
export const RecordSiteSelect = ({ sites, providers, ...selection }: RecordSiteSelectProps) => (
    <MultiSelectField
        {...selection}
        items={sites}
        label="Sites"
        renderName={(site) => <SiteName site={site} />}
        renderInfo={(site) => <SiteInfo site={site} providers={providers} />}
        removeTooltip="Remove from Record"
        noneSelected="No site selected: the record is parked and written to no provider"
        emptyList={
            <>
                There is no site yet. A record goes to the providers of its sites —{" "}
                <Link to={ROUTES.siteNew} className="text-primary hover:underline">
                    add a site
                </Link>{" "}
                first.
            </>
        }
        hint="The record goes to every provider of the sites chosen here."
    />
);
