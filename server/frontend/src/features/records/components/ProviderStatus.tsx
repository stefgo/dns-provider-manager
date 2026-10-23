import type { DnsRecord, Provider } from "@dpm/shared";
import { Badge, StatusDot, Tooltip } from "@stefgo/react-ui-components";
import { LINK_LABEL, LINK_TONE, linkDetail, linksInOrder, overallState, providerName } from "../lib/recordSync";

/**
 * A record's state at all its providers as one badge, the most urgent state. The tooltip
 * says it and then each provider, in the order of the provider list, with its state and
 * what it holds instead or why it failed.
 */
export const ProviderStatus = ({ record, providers }: { record: Pick<DnsRecord, "links">; providers: Provider[] }) => {
    const overall = overallState(record.links);
    if (!overall) return <span className="text-sm text-text-muted">–</span>;
    return (
        <Tooltip
            content={
                <span className="block max-w-xs">
                    <span className="block font-medium">{overall.label}</span>
                    {linksInOrder(record.links, providers).map((link) => {
                        const detail = linkDetail(link);
                        return (
                            <span key={link.providerId} className="mt-1 flex items-start gap-1.5">
                                <StatusDot tone={LINK_TONE[link.status]} size="sm" pulse={false} className="mt-1.5" />
                                <span>
                                    {providerName(link.providerId, providers)}: {LINK_LABEL[link.status]}
                                    {detail && <span className="block text-xs opacity-80">{detail}</span>}
                                </span>
                            </span>
                        );
                    })}
                </span>
            }
        >
            <span tabIndex={0} className="inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <Badge variant={overall.tone} className="whitespace-nowrap">
                    {overall.label}
                </Badge>
            </span>
        </Tooltip>
    );
};
