import { Link } from "react-router-dom";
import { PROVIDER_TYPE_LABELS, type Provider } from "@dpm/shared";
import { InfoGrid, InfoRow, MultiSelectField } from "../../../components/MultiSelectField";
import { RelativeTime } from "../../../components/RelativeTime";
import { ROUTES } from "../../../lib/paths";
import { accessDetails, connectionDetails } from "../../providers/lib/providerDetails";

/** What a provider's row opens to: where it is reached and how its last reading went. */
const ProviderInfo = ({ provider }: { provider: Provider }) => (
    <InfoGrid>
        <InfoRow label="Type">{PROVIDER_TYPE_LABELS[provider.type]}</InfoRow>
        {[...connectionDetails(provider), ...accessDetails(provider)].map((line) => (
            <InfoRow key={line.label} label={line.label}>
                {line.value}
            </InfoRow>
        ))}
        <InfoRow label="Last Reading">
            {provider.lastError !== null ? (
                <span className="text-error">{provider.lastError}</span>
            ) : provider.lastSeenAt ? (
                <RelativeTime date={provider.lastSeenAt} />
            ) : (
                "Not read yet"
            )}
        </InfoRow>
    </InfoGrid>
);

const ProviderName = ({ provider }: { provider: Provider }) => (
    <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium text-text-primary">{provider.name}</span>
        <span className="shrink-0 text-xs text-text-muted">{PROVIDER_TYPE_LABELS[provider.type]}</span>
    </div>
);

interface SiteProviderSelectProps {
    providers: Provider[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
    isSelecting: boolean;
    onSetIsSelecting: (selecting: boolean) => void;
}

/** The providers of a site: each opens to where it is reached and how dpm signs in. */
export const SiteProviderSelect = ({ providers, ...selection }: SiteProviderSelectProps) => (
    <MultiSelectField
        {...selection}
        items={providers}
        label="Providers"
        renderName={(provider) => <ProviderName provider={provider} />}
        renderInfo={(provider) => <ProviderInfo provider={provider} />}
        removeTooltip="Remove from Site"
        noneSelected="No provider selected"
        emptyList={
            <>
                There is no provider yet.{" "}
                <Link to={ROUTES.providerNew} className="text-primary hover:underline">
                    Add a provider
                </Link>{" "}
                and come back to give it this site.
            </>
        }
        hint="Every record of this site goes to each provider chosen here."
    />
);
