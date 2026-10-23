import type { DnsRecord, LinkStatus, Provider, RecordLinkView, RecordPreview, Site, SyncAction } from "@dpm/shared";
import type { StatusDotTone } from "@stefgo/react-ui-components";

/** The tones a record's state takes: those a `StatusDot` and a `Badge` both know. */
export type LinkTone = Extract<StatusDotTone, "success" | "warning" | "error" | "info" | "neutral">;

/** The colour of a record's state at one provider: green is there as written, red failed, amber changed there. */
export const LINK_TONE: Record<LinkStatus, LinkTone> = {
    in_sync: "success",
    pending: "neutral",
    error: "error",
    drift: "warning",
    missing: "warning",
    removing: "info",
};

export const LINK_LABEL: Record<LinkStatus, string> = {
    in_sync: "In sync",
    pending: "Not written yet",
    error: "Writing failed",
    drift: "Changed at the provider",
    missing: "Deleted at the provider",
    removing: "Being removed",
};

/** What a provider holds instead, or why the record is held back or failed there. */
export function linkDetail(link: Pick<RecordLinkView, "status" | "error" | "observed">): string | null {
    if (link.status === "drift" && link.observed) {
        return link.observed.disabled ? `Switched off there (${link.observed.value})` : `Holds ${link.observed.value} instead`;
    }
    return link.error;
}

/**
 * Whether the state asks for someone to look: failed, changed or deleted at the provider, a
 * removal that failed. A record held back on purpose (read only) or under way is not one.
 */
export const isProblem = (link: Pick<RecordLinkView, "status" | "error">) =>
    link.status === "error" || link.status === "drift" || link.status === "missing" || (link.status === "removing" && link.error !== null);

export const hasProblem = (record: Pick<DnsRecord, "links">) => record.links.some(isProblem);

/** How urgent a state is, lowest first: what failed, then what changed at the provider, then what is under way. */
const urgency = (link: Pick<RecordLinkView, "status" | "error">) => {
    if (link.status === "error" || (link.status === "removing" && link.error !== null)) return 0;
    return { missing: 1, drift: 2, pending: 3, removing: 4, in_sync: 5, error: 0 }[link.status];
};

/**
 * A record's state at all its providers in one: the most urgent one, and at how many of
 * them it is when not at every one. Null for a record that goes to no provider.
 */
export function overallState(links: readonly Pick<RecordLinkView, "status" | "error">[]): { tone: LinkTone; label: string } | null {
    if (links.length === 0) return null;
    const worst = links.reduce((a, b) => (urgency(b) < urgency(a) ? b : a));
    const count = links.filter((l) => urgency(l) === urgency(worst)).length;
    const failedRemoval = worst.status === "removing" && worst.error !== null;
    const label = failedRemoval ? "Removal failed" : LINK_LABEL[worst.status];
    return {
        tone: failedRemoval ? "error" : LINK_TONE[worst.status],
        label: count === links.length ? label : `${label} (${count} of ${links.length})`,
    };
}

/** Whether the provider holds an entry dpm wrote or took over -- one a release leaves there. */
export const holdsEntry = (link: Pick<RecordLinkView, "status" | "syncedAt">) => link.syncedAt !== null && link.status !== "missing";

/** The name of a provider, or its id while the list has not arrived. */
export const providerName = (id: string, providers: readonly Pick<Provider, "id" | "name">[]) =>
    providers.find((p) => p.id === id)?.name ?? id;

/** A record's states in the order of the provider list, so the dots of every row line up. */
export function linksInOrder<L extends { providerId: string }>(links: readonly L[], providers: readonly Pick<Provider, "id">[]): L[] {
    const rank = (id: string) => {
        const index = providers.findIndex((p) => p.id === id);
        return index === -1 ? providers.length : index;
    };
    return [...links].sort((a, b) => rank(a.providerId) - rank(b.providerId));
}

/** What saving does at a provider, as the editor's preview says it. */
export const ACTION_LABEL: Record<SyncAction, string> = {
    create: "Writes it",
    update: "Changes it",
    delete: "Removes it",
    adopt: "Takes over the entry it holds",
    none: "Nothing to write",
    blocked: "Held back",
    conflict: "Refused",
};

export const ACTION_TONE: Record<SyncAction, StatusDotTone> = {
    create: "info",
    update: "info",
    delete: "warning",
    adopt: "success",
    none: "neutral",
    blocked: "neutral",
    conflict: "error",
};

/** The providers a save or a deletion would remove the record from, by name. */
export const removedAt = (preview: Pick<RecordPreview, "steps"> | null | undefined, providers: readonly Pick<Provider, "id" | "name">[]) =>
    (preview?.steps ?? []).filter((s) => s.action === "delete").map((s) => providerName(s.providerId, providers));

/**
 * What a toast says after a save, or null when every provider took it. The record is saved
 * either way; a provider that failed is tried again after its next reading.
 */
export function saveOutcome(
    record: Pick<DnsRecord, "links">,
    providers: readonly Pick<Provider, "id" | "name">[],
): { variant: "warning"; title: string; description: string } | null {
    const failed = record.links.filter((l) => l.status === "error");
    if (failed.length === 0) return null;
    return {
        variant: "warning",
        title: "Saved, but not written everywhere",
        description: [
            ...failed.map((l) => `${providerName(l.providerId, providers)}: ${l.error ?? "failed"}`),
            "It is tried again after the provider's next reading.",
        ].join("\n"),
    };
}

/**
 * What taking over a provider's state does, for the question before it. A changed value
 * goes to every other provider of the record. A deletion takes the record out of the sites
 * it reached the provider through -- parking it when none is left -- and off the other
 * providers of those sites that no remaining site reaches.
 */
export function acceptEffect(
    record: Pick<DnsRecord, "siteIds" | "links">,
    link: Pick<RecordLinkView, "providerId" | "status" | "observed">,
    sites: readonly Pick<Site, "id" | "name" | "providerIds">[],
    providers: readonly Pick<Provider, "id" | "name">[],
): { change: { value: string } | { leaves: string[]; parked: boolean }; others: string[] } {
    const others = record.links.filter((l) => l.providerId !== link.providerId && l.status !== "removing");
    const names = (links: readonly { providerId: string }[]) => links.map((l) => providerName(l.providerId, providers));
    if (link.status === "drift" && link.observed && !link.observed.disabled) {
        return { change: { value: link.observed.value }, others: names(others) };
    }
    const own = sites.filter((s) => record.siteIds.includes(s.id));
    const through = own.filter((s) => s.providerIds.includes(link.providerId));
    const remaining = own.filter((s) => !through.includes(s));
    const stillReached = new Set(remaining.flatMap((s) => s.providerIds));
    return {
        change: { leaves: through.map((s) => s.name), parked: remaining.length === 0 },
        others: names(others.filter((l) => !stillReached.has(l.providerId))),
    };
}
