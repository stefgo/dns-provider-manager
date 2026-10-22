import type { ConfirmOptions } from "@stefgo/react-ui-components";
import type { DnsRecord } from "@dpm/shared";

/** Deleting a record takes it out of every site it belongs to. */
export function describeDeleteRecord(record: Pick<DnsRecord, "name" | "type" | "value" | "siteIds">): ConfirmOptions {
    return {
        title: `Delete ${record.name} ${record.type} ${record.value}?`,
        description:
            record.siteIds.length > 1
                ? `The record leaves all ${record.siteIds.length} sites it belongs to.`
                : "The record leaves the site it belongs to.",
        confirmLabel: "Delete record",
        variant: "danger",
    };
}
