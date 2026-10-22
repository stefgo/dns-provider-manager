import type { ConfirmOptions } from "@stefgo/react-ui-components";
import type { DnsRecord } from "@dpm/shared";
import { nameList } from "../../utils";

/** Deleting a record takes it out of every site it belongs to, and off the providers that hold it. */
export function describeDeleteRecord(
    record: Pick<DnsRecord, "name" | "type" | "value" | "siteIds">,
    removedAt: readonly string[],
): ConfirmOptions {
    const sites =
        record.siteIds.length > 1 ? `The record leaves all ${record.siteIds.length} sites it belongs to` : "The record leaves the site it belongs to";
    return {
        title: `Delete ${record.name} ${record.type} ${record.value}?`,
        description: removedAt.length > 0 ? `${sites}, and is removed from ${nameList(removedAt)}.` : `${sites}.`,
        confirmLabel: "Delete record",
        variant: "danger",
    };
}

/** Saving removes the record from providers: it changed its sites, or its name moved. */
export function describeSaveRemoving(name: string, removedAt: readonly string[]): ConfirmOptions {
    return {
        title: `Remove ${name} from ${nameList(removedAt)}?`,
        description: `Saving removes the record there, once every provider it goes to holds it. Nothing is removed while one of them has not taken it.`,
        confirmLabel: "Save and remove",
        variant: "danger",
    };
}

/** Writing dpm's value over what a provider holds. */
export function describeRewrite(record: Pick<DnsRecord, "name" | "value">, provider: string): ConfirmOptions {
    return {
        title: `Write ${record.name} to ${provider} again?`,
        description: `${provider} gets ${record.value} again, as dpm holds it. What was changed there is overwritten.`,
        confirmLabel: "Write again",
        variant: "primary",
    };
}

/**
 * Taking over what a provider holds. A changed value goes to every other provider of the
 * record; a deletion takes the record out of the sites it reached that provider through.
 */
export function describeAccept(
    record: Pick<DnsRecord, "name" | "value">,
    provider: string,
    change: { value: string } | { leaves: readonly string[]; deleted: boolean },
    otherProviders: readonly string[],
): ConfirmOptions {
    const others = otherProviders.length > 0 ? nameList(otherProviders) : null;
    if ("value" in change) {
        return {
            title: `Take over ${change.value} from ${provider}?`,
            description: `The record changes from ${record.value} to ${change.value}${others ? `, and ${others} get${otherProviders.length === 1 ? "s" : ""} it too` : ""}.`,
            confirmLabel: "Take over",
            variant: "primary",
        };
    }
    return {
        title: change.deleted ? `Delete ${record.name}?` : `Take ${record.name} out of ${nameList(change.leaves)}?`,
        description: `${provider} does not hold it any more. ${
            change.deleted ? "The record has no other site and is deleted" : `The record leaves ${nameList(change.leaves)}`
        }${others ? `, and is removed from ${others}` : ""}. What ${provider} holds is left as it is.`,
        confirmLabel: change.deleted ? "Delete record" : "Take over",
        variant: "danger",
    };
}
