import type { DnsRecord, PendingRemoval, Provider, RecordLinkView, Site } from "./types.js";

/**
 * What needs a look across the providers right now, as the dashboard's "Needs attention"
 * lists it -- and as the server's status report (`GET /api/v1/status`) answers it. One
 * implementation for both, so the two cannot disagree. Where a finding leads is a `target`
 * here; the dashboard turns it into a link.
 *
 * A finding is a state, not an event: it is there while the problem is, and goes by itself
 * once it is solved -- there is nothing to mark as seen. That is what tells it from a row
 * under "Errors / Warnings", which records that something happened and stays until somebody
 * has looked. Everything is read from what the cache already holds and the socket keeps current.
 */

/** A count with its noun: "1 record", "3 records". `many` for nouns without a plain -s plural. */
export const plural = (count: number, one: string, many = `${one}s`): string =>
    `${count} ${count === 1 ? one : many}`;

/** The name of a provider, or its id while the list has not arrived. */
export const providerName = (id: string, providers: readonly Pick<Provider, "id" | "name">[]) =>
    providers.find((p) => p.id === id)?.name ?? id;

/** What a provider holds instead, or why the record is held back or failed there. */
export function linkDetail(link: Pick<RecordLinkView, "status" | "error" | "observed">): string | null {
    if (link.status === "drift" && link.observed) {
        return link.observed.disabled ? `Switched off there (${link.observed.value})` : `Holds ${link.observed.value} instead`;
    }
    return link.error;
}

export type FindingSeverity = "error" | "warning";

/** Every kind of finding, in the order the list shows them within a severity: providers, records, sites. */
const FINDING_TYPES = [
    "provider-unreachable",
    "record-write-failed",
    "removal-failed",
    "provider-not-read",
    "record-missing",
    "record-drift",
    "record-no-target",
    "site-without-provider",
] as const;

export type FindingType = (typeof FINDING_TYPES)[number];

/** Where a finding can be dealt with: a page of the dashboard, named rather than linked. */
export type FindingTarget =
    | { kind: "record"; id: string }
    | { kind: "provider"; id: string }
    | { kind: "site"; id: string }
    | { kind: "records" }
    | { kind: "records-problems" };

export interface Finding {
    /** What makes this finding this one: its type and what it is about. Not its text. */
    id: string;
    type: FindingType;
    severity: FindingSeverity;
    text: string;
    /** Where the reader can do something about it. */
    target?: FindingTarget;
    /** For a provider that is not reachable: when it last was, if ever. */
    lastReached?: string | null;
}

export interface FindingsInput {
    records: readonly DnsRecord[];
    providers: readonly Provider[];
    sites: readonly Site[];
    /** Deleted records a provider still holds. */
    removals: readonly PendingRemoval[];
}

/**
 * More findings of one kind at one provider than this are one line: twenty lines "changed at
 * AdGuard 1" hide whatever else is wrong, and they have one place to be dealt with anyway.
 */
export const GROUP_ABOVE = 5;

const SEVERITY_ORDER: Record<FindingSeverity, number> = { error: 0, warning: 1 };

const recordLabel = (r: Pick<DnsRecord, "name" | "type" | "value">) => `${r.name} ${r.type} ${r.value}`;

const withReason = (text: string, reason: string | null | undefined) => (reason ? `${text}: ${reason}` : text);

/** A provider dpm could not reach the last time it tried. */
export const isUnreachable = (provider: Pick<Provider, "lastError">) => provider.lastError !== null;

/** A provider that was neither reached nor failed: never read yet. One this build cannot read is not waited for. */
export const isNotRead = (provider: Pick<Provider, "lastError" | "lastSeenAt" | "readable">) =>
    provider.readable && provider.lastError === null && provider.lastSeenAt === null;

/** A finding about one record at one provider, before findings of one kind are taken together. */
interface RecordItem {
    type: Extract<FindingType, "record-write-failed" | "removal-failed" | "record-missing" | "record-drift" | "record-no-target">;
    /** Null for what is about the record alone. */
    providerId: string | null;
    key: string;
    text: string;
    target: FindingTarget;
}

/** What one link of a record says, if it says anything. Waiting and in sync say nothing. */
function linkItem(record: DnsRecord, link: RecordLinkView, at: string): RecordItem | null {
    const target: FindingTarget = { kind: "record", id: record.id };
    const base = { providerId: link.providerId, key: `${record.id}:${link.providerId}`, target };
    const label = recordLabel(record);
    switch (link.status) {
        case "error":
            return { ...base, type: "record-write-failed", text: withReason(`${label} could not be written to ${at}`, link.error) };
        case "removing":
            return link.error === null
                ? null
                : { ...base, type: "removal-failed", text: withReason(`${label} could not be removed from ${at}`, link.error) };
        case "missing":
            return { ...base, type: "record-missing", text: `${label} was deleted at ${at}` };
        case "drift":
            return { ...base, type: "record-drift", text: withReason(`${label} changed at ${at}`, linkDetail(link)) };
        default:
            return null;
    }
}

/** The line that stands for more than `GROUP_ABOVE` findings of one kind. */
function groupText(type: RecordItem["type"], count: number, at: string | null): string {
    const records = plural(count, "record");
    switch (type) {
        case "record-write-failed":
            return `${records} could not be written to ${at}`;
        case "removal-failed":
            return `${records} could not be removed from ${at}`;
        case "record-missing":
            return `${records} were deleted at ${at}`;
        case "record-drift":
            return `${records} changed at ${at}`;
        case "record-no-target":
            return `${records} go to no provider of their sites`;
    }
}

const RECORD_SEVERITY: Record<RecordItem["type"], FindingSeverity> = {
    "record-write-failed": "error",
    "removal-failed": "error",
    "record-missing": "warning",
    "record-drift": "warning",
    "record-no-target": "warning",
};

/**
 * Everything that needs a look: errors first, then by kind -- what is wrong with a provider
 * before what is wrong with a record at it -- then by text.
 *
 * A provider that cannot be reached takes the failed writes and removals at it into its own
 * finding: they have the one cause, and it is the one line that says what to do.
 */
export function buildFindings({ records, providers, sites, removals }: FindingsInput): Finding[] {
    const found: Finding[] = [];
    const unreachable = new Set(providers.filter(isUnreachable).map((p) => p.id));
    const waiting = new Map<string, number>();
    const wait = (providerId: string) => waiting.set(providerId, (waiting.get(providerId) ?? 0) + 1);
    const items: RecordItem[] = [];

    for (const record of records) {
        for (const link of record.links) {
            if (unreachable.has(link.providerId)) {
                if (link.status === "error" || link.status === "pending" || link.status === "removing") wait(link.providerId);
                if (link.status === "error" || link.status === "removing") continue;
            }
            const item = linkItem(record, link, providerName(link.providerId, providers));
            if (item) items.push(item);
        }
        // A record whose sites have no provider at all is the site's finding, not its own.
        const reachable = sites.some((s) => record.siteIds.includes(s.id) && s.providerIds.length > 0);
        if (record.siteIds.length > 0 && record.links.length === 0 && reachable) {
            items.push({
                type: "record-no-target",
                providerId: null,
                key: record.id,
                text: withReason(`${recordLabel(record)} goes to no provider of its sites`, record.skipped[0]?.reason),
                target: { kind: "record", id: record.id },
            });
        }
    }

    for (const removal of removals) {
        if (removal.error === null) continue;
        if (unreachable.has(removal.providerId)) {
            wait(removal.providerId);
            continue;
        }
        items.push({
            type: "removal-failed",
            providerId: removal.providerId,
            key: `deleted:${removal.providerId}:${recordLabel(removal)}`,
            text: withReason(
                `Deleted record ${recordLabel(removal)} could not be removed from ${providerName(removal.providerId, providers)}`,
                removal.error,
            ),
            target: { kind: "records" },
        });
    }

    const groups = new Map<string, RecordItem[]>();
    for (const item of items) {
        const key = `${item.type}:${item.providerId ?? ""}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const [key, group] of groups) {
        const { type, providerId } = group[0];
        const severity = RECORD_SEVERITY[type];
        if (group.length > GROUP_ABOVE) {
            const at = providerId === null ? null : providerName(providerId, providers);
            found.push({
                id: `${key}:group`,
                type,
                severity,
                text: groupText(type, group.length, at),
                target: type === "record-no-target" ? { kind: "records" } : { kind: "records-problems" },
            });
        } else {
            for (const item of group) found.push({ id: `${type}:${item.key}`, type, severity, text: item.text, target: item.target });
        }
    }

    for (const provider of providers) {
        if (isUnreachable(provider)) {
            const count = waiting.get(provider.id) ?? 0;
            const text = withReason(`${provider.name} is not reachable`, provider.lastError);
            found.push({
                id: `provider-unreachable:${provider.id}`,
                type: "provider-unreachable",
                severity: "error",
                text: count > 0 ? `${text} · ${plural(count, "record waits", "records wait")} for it` : text,
                target: { kind: "provider", id: provider.id },
                lastReached: provider.lastSeenAt,
            });
        } else if (isNotRead(provider)) {
            found.push({
                id: `provider-not-read:${provider.id}`,
                type: "provider-not-read",
                severity: "warning",
                text: `${provider.name} has not been read yet`,
                target: { kind: "provider", id: provider.id },
            });
        }
    }

    for (const site of sites) {
        if (site.providerIds.length > 0 || site.recordCount === 0) continue;
        found.push({
            id: `site-without-provider:${site.id}`,
            type: "site-without-provider",
            severity: "warning",
            text: `Site ${site.name} has no provider to write its ${plural(site.recordCount, "record")} to`,
            target: { kind: "site", id: site.id },
        });
    }

    return found.sort(
        (a, b) =>
            SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
            FINDING_TYPES.indexOf(a.type) - FINDING_TYPES.indexOf(b.type) ||
            a.text.localeCompare(b.text, undefined, { sensitivity: "base" }),
    );
}

export type DnsStatus = "healthy" | "degraded" | "critical" | "unknown";

/**
 * How DNS is doing, by its worst finding. Until some provider has been read -- reached or
 * failed -- nothing can be said: "Healthy" would be a claim without anything behind it.
 */
export function dnsStatus(findings: readonly Pick<Finding, "severity">[], providers: readonly Pick<Provider, "lastError" | "lastSeenAt">[]): DnsStatus {
    if (!providers.some((p) => p.lastSeenAt !== null || p.lastError !== null)) return "unknown";
    if (findings.some((f) => f.severity === "error")) return "critical";
    if (findings.length > 0) return "degraded";
    return "healthy";
}

/** How many providers there are, and how their last reading went. */
export interface ProviderCount {
    total: number;
    reachable: number;
    unreachable: number;
    notRead: number;
}

/** What the "Providers reachable" card counts, and the status report's summary with it. */
export function providerCount(providers: readonly Pick<Provider, "lastError" | "lastSeenAt" | "readable">[]): ProviderCount {
    const unreachable = providers.filter(isUnreachable).length;
    const notRead = providers.filter(isNotRead).length;
    const reachable = providers.filter((p) => !isUnreachable(p) && p.lastSeenAt !== null).length;
    return { total: providers.length, reachable, unreachable, notRead };
}
