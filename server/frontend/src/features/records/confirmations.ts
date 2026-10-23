import type { ConfirmOptions } from "@stefgo/react-ui-components";
import type { DnsRecord } from "@dpm/shared";
import { nameList } from "../../utils";

/** Deleting a record takes it out of every site it belongs to, and off the providers that hold it. */
export function describeDeleteRecord(
    record: Pick<DnsRecord, "name" | "type" | "value" | "siteIds">,
    removedAt: readonly string[],
): ConfirmOptions {
    const count = record.siteIds.length;
    const sites =
        count > 1 ? `The record leaves all ${count} sites it belongs to` : count === 1 ? "The record leaves the site it belongs to" : "The record is deleted";
    return {
        title: `Delete ${record.name} ${record.type} ${record.value}?`,
        description: removedAt.length > 0 ? `${sites}, and is removed from ${nameList(removedAt)}.` : `${sites}.`,
        confirmLabel: "Delete record",
        variant: "danger",
    };
}

/** Releasing a record: dpm forgets it, and the providers that hold it keep it as it is. */
export function describeReleaseRecord(record: Pick<DnsRecord, "name" | "type" | "value">, heldAt: readonly string[]): ConfirmOptions {
    return {
        title: `Release ${record.name} ${record.type} ${record.value}?`,
        description:
            heldAt.length > 0
                ? `dpm stops managing it and deletes it here. ${nameList(heldAt)} ${heldAt.length === 1 ? "keeps" : "keep"} it as it is; it shows up under Unmanaged and can be adopted again.`
                : "No provider holds it; it is deleted here.",
        confirmLabel: "Release",
        variant: "danger",
    };
}

/**
 * Saving removes the record from providers: it changed its sites, or its name moved. Without
 * a site left it is parked, and nothing waits for another provider to take it first.
 */
export function describeSaveRemoving(name: string, removedAt: readonly string[], parked = false): ConfirmOptions {
    if (parked) {
        return {
            title: `Park ${name}?`,
            description: `The record has no site any more: it stays here and is removed from ${nameList(removedAt)}.`,
            confirmLabel: "Save and park",
            variant: "danger",
        };
    }
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
 * record; a deletion takes the record out of the sites it reached that provider through,
 * and parks it when it has no other.
 */
export function describeAccept(
    record: Pick<DnsRecord, "name" | "value">,
    provider: string,
    change: { value: string } | { leaves: readonly string[]; parked: boolean },
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
        title: change.parked ? `Park ${record.name}?` : `Take ${record.name} out of ${nameList(change.leaves)}?`,
        description: `${provider} does not hold it any more. ${
            change.parked
                ? "The record has no other site and is parked: it stays here and is written to no provider"
                : `The record leaves ${nameList(change.leaves)}`
        }${others ? `, and is removed from ${others}` : ""}. What ${provider} holds is left as it is.`,
        confirmLabel: change.parked ? "Park record" : "Take over",
        variant: "danger",
    };
}
