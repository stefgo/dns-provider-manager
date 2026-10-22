import type { DnsRecord, RecordLinkView } from "@dpm/shared";
import { useConfirm, useToast } from "@stefgo/react-ui-components";
import { useProviders } from "../../../queries/providers";
import { useRecordAction } from "../../../queries/records";
import { useSites } from "../../../queries/sites";
import { describeFailure } from "../../../utils";
import { describeAccept, describeRewrite } from "../confirmations";
import { acceptEffect, providerName, saveOutcome } from "../lib/recordSync";

/**
 * What can be done about a record at its providers, with the question before each and the
 * report after: write it again everywhere (`sync`, no question -- it only repeats what saving
 * did), write dpm's value over what one provider holds, or take that over.
 */
export function useLinkActions() {
    const { confirm, alert } = useConfirm();
    const { show } = useToast();
    const { providers } = useProviders();
    const { sites } = useSites();
    const action = useRecordAction();

    const report = (record: DnsRecord | null) => {
        const outcome = record && saveOutcome(record, providers);
        if (outcome) show({ ...outcome, duration: 0 });
    };

    const sync = async (record: DnsRecord) => {
        try {
            const result = await action.mutateAsync({ id: record.id, action: "sync" });
            report(result);
            if (result && !saveOutcome(result, providers)) show({ variant: "success", title: `${record.name} written to its providers` });
        } catch (err) {
            await alert(describeFailure(`${record.name} was not written again`, err));
        }
    };

    const rewrite = (record: DnsRecord, link: RecordLinkView) =>
        confirm({
            ...describeRewrite(record, providerName(link.providerId, providers)),
            onConfirm: async () => report(await action.mutateAsync({ id: record.id, action: "rewrite", providerId: link.providerId })),
        });

    const accept = (record: DnsRecord, link: RecordLinkView) => {
        const { change, others } = acceptEffect(record, link, sites, providers);
        return confirm({
            ...describeAccept(record, providerName(link.providerId, providers), change, others),
            onConfirm: async () => report(await action.mutateAsync({ id: record.id, action: "accept", providerId: link.providerId })),
        });
    };

    return { sync, rewrite, accept, isPending: action.isPending };
}
