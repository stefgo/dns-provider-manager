import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Trash2 } from "lucide-react";
import { PROVIDER_TYPE_LABELS, type Provider } from "@dpm/shared";
import { ActionButton, FOCUS_RING, FieldLabel, cn } from "@stefgo/react-ui-components";
import { RelativeTime } from "../../../components/RelativeTime";
import { ROUTES } from "../../../lib/paths";
import { accessDetails, connectionDetails } from "../../providers/lib/providerDetails";

const LINK_BUTTON = cn("rounded-sm text-xs font-bold text-primary hover:underline", FOCUS_RING);

const InfoRow = ({ label, children }: { label: string; children: ReactNode }) => (
    <>
        <span className="text-text-muted">{label}:</span>
        <span className="break-all text-text-primary">{children}</span>
    </>
);

/** What a provider's row opens to: where it is reached and how its last reading went. */
const ProviderInfo = ({ provider }: { provider: Provider }) => (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border bg-app-bg px-12 py-3 text-xs">
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
    </div>
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
    /** Whether the list to pick from is open. The editor holds it: Escape closes it first. */
    isSelecting: boolean;
    onSetIsSelecting: (selecting: boolean) => void;
}

/**
 * The providers of a site, the way pbcm's job editor shows its repository: the chosen ones
 * in a box, each opening to its details and removable on its own, and a list to pick from
 * in their place. A site has several providers, so a click in the list ticks or unticks one
 * and the list stays open until "Done".
 */
export const SiteProviderSelect = ({
    providers,
    selectedIds,
    onChange,
    isSelecting,
    onSetIsSelecting,
}: SiteProviderSelectProps) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const isSelected = (provider: Provider) => selectedIds.includes(provider.id);
    const toggle = (provider: Provider) =>
        onChange(
            isSelected(provider) ? selectedIds.filter((id) => id !== provider.id) : [...selectedIds, provider.id],
        );

    const expandButton = (provider: Provider) => {
        const expanded = expandedId === provider.id;
        return (
            <ActionButton
                icon={expanded ? ChevronDown : ChevronRight}
                size="sm"
                tooltip={expanded ? "Collapse" : "Expand"}
                onClick={(e) => {
                    e.stopPropagation();
                    setExpandedId(expanded ? null : provider.id);
                }}
            />
        );
    };

    if (isSelecting) {
        const onRowKey = (e: KeyboardEvent, provider: Provider) => {
            if (e.target !== e.currentTarget || (e.key !== " " && e.key !== "Enter")) return;
            e.preventDefault();
            toggle(provider);
        };

        return (
            <div className="space-y-1">
                <div className="flex items-center justify-between">
                    <FieldLabel as="div" className="mb-0 ml-0">
                        Select Providers
                    </FieldLabel>
                    <button type="button" onClick={() => onSetIsSelecting(false)} className={LINK_BUTTON}>
                        Done
                    </button>
                </div>

                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {providers.map((provider) => (
                        <div key={provider.id} className="flex flex-col">
                            <div
                                role="checkbox"
                                aria-checked={isSelected(provider)}
                                tabIndex={0}
                                onClick={() => toggle(provider)}
                                onKeyDown={(e) => onRowKey(e, provider)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-hover",
                                    FOCUS_RING,
                                )}
                            >
                                {expandButton(provider)}
                                <div className="flex min-w-0 items-center gap-2">
                                    {isSelected(provider) ? (
                                        <CheckCircle2 size={18} className="shrink-0 animate-pulse-soft text-primary" />
                                    ) : (
                                        <Circle size={18} className="shrink-0 text-border" />
                                    )}
                                    <ProviderName provider={provider} />
                                </div>
                            </div>
                            {expandedId === provider.id && <ProviderInfo provider={provider} />}
                        </div>
                    ))}
                    {providers.length === 0 && (
                        <div className="p-8 text-center text-sm text-text-muted">
                            There is no provider yet.{" "}
                            <Link to={ROUTES.providerNew} className="text-primary hover:underline">
                                Add a provider
                            </Link>{" "}
                            and come back to give it this site.
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const selected = providers.filter(isSelected);

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <FieldLabel as="div" className="mb-0 ml-0">
                    Providers
                </FieldLabel>
                <button type="button" onClick={() => onSetIsSelecting(true)} className={LINK_BUTTON}>
                    {selected.length > 0 ? "Change Providers" : "Add Providers"}
                </button>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-app-bg p-2">
                {selected.map((provider) => (
                    <div key={provider.id} className="overflow-hidden rounded border border-border bg-card">
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                                {expandButton(provider)}
                                <ProviderName provider={provider} />
                            </div>
                            <ActionButton
                                icon={Trash2}
                                size="sm"
                                color="orange"
                                tooltip="Remove from Site"
                                onClick={() => toggle(provider)}
                            />
                        </div>
                        {expandedId === provider.id && <ProviderInfo provider={provider} />}
                    </div>
                ))}
                {selected.length === 0 && <div className="px-1 py-2 text-text-muted">No provider selected</div>}
            </div>
            <p className="text-xs text-text-muted">Every record of this site goes to each provider chosen here.</p>
        </div>
    );
};
