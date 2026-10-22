import type { DnsRecord, Provider } from "@dpm/shared";
import { StatusDot, Tooltip } from "@stefgo/react-ui-components";
import { LINK_LABEL, LINK_TONE, linkDetail, linksInOrder, providerName } from "../lib/recordSync";

/**
 * A record's state at each provider, one dot each, in the order of the provider list. The
 * tooltip names the provider, the state and what it holds instead or why it failed.
 */
export const ProviderDots = ({ record, providers }: { record: Pick<DnsRecord, "links">; providers: Provider[] }) => {
    if (record.links.length === 0) return <span className="text-sm text-text-muted">–</span>;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {linksInOrder(record.links, providers).map((link) => {
                const name = providerName(link.providerId, providers);
                const detail = linkDetail(link);
                return (
                    <Tooltip
                        key={link.providerId}
                        content={
                            <span className="block max-w-xs">
                                <span className="font-medium">{name}</span>: {LINK_LABEL[link.status]}
                                {detail && <span className="block text-xs opacity-80">{detail}</span>}
                            </span>
                        }
                    >
                        <span tabIndex={0} className="inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            <StatusDot tone={LINK_TONE[link.status]} size="sm" pulse={false} label={`${name}: ${LINK_LABEL[link.status]}`} />
                        </span>
                    </Tooltip>
                );
            })}
        </div>
    );
};
