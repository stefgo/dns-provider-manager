import type { ActivityRecord, DnsRecord, Provider, Site } from "@dpm/shared";
import type { StatusDotTone } from "@stefgo/react-ui-components";
import { groupActivity } from "../../activity/lib/groupActivity";
import { readTone } from "../../providers/lib/providerDetails";
import { isParked, matchesStatus } from "../../records/lib/recordFilters";
import { hasProblem, worstState } from "../../records/lib/recordSync";
import { plural } from "../../../utils";
import { isNotRead, isUnreachable } from "./findings";

/**
 * The numbers the dashboard's cards show. Counted here, once, so a card and a badge that
 * show the same number cannot disagree about it.
 */

/** The rows the user has not seen that ask for a look, by how loudly. */
export interface UnseenProblems {
    errors: number;
    warnings: number;
}

/**
 * What the activity list opens on from the Errors / Warnings card: unseen rows at warning
 * and above, counted as rows -- grouped the way the list groups them, each at the level its
 * row carries.
 */
export function unseenProblems(events: ActivityRecord[]): UnseenProblems {
    let errors = 0;
    let warnings = 0;
    for (const group of groupActivity(events)) {
        if (!group.unseen) continue;
        if (group.level === "error") errors++;
        else if (group.level === "warning") warnings++;
    }
    return { errors, warnings };
}

/**
 * What the "Errors / Warnings" card says below its number: what the number is made of.
 * A part that is zero is left out, and with nothing unseen the card says that instead.
 */
export function problemSummary({ errors, warnings }: UnseenProblems): string {
    const parts = [
        errors > 0 ? plural(errors, "error") : null,
        warnings > 0 ? plural(warnings, "warning") : null,
    ].filter((part) => part !== null);
    return parts.length > 0 ? parts.join(" · ") : "Nothing unseen";
}

/** How many providers there are, and how their last reading went. */
export interface ProviderCount {
    total: number;
    reachable: number;
    unreachable: number;
    notRead: number;
}

export function providerCount(providers: readonly Pick<Provider, "lastError" | "lastSeenAt" | "readable">[]): ProviderCount {
    const unreachable = providers.filter(isUnreachable).length;
    const notRead = providers.filter(isNotRead).length;
    const reachable = providers.filter((p) => !isUnreachable(p) && p.lastSeenAt !== null).length;
    return { total: providers.length, reachable, unreachable, notRead };
}

/** "3 / 4": reachable of all. */
export const formatReachable = ({ reachable, total }: ProviderCount) => `${reachable} / ${total}`;

/** What the "Providers reachable" card says below its number. */
export function providerSummary({ total, unreachable, notRead }: ProviderCount): string {
    if (total === 0) return "No provider yet";
    const parts = [
        unreachable > 0 ? `${unreachable} unreachable` : null,
        notRead > 0 ? `${notRead} not read yet` : null,
    ].filter((part) => part !== null);
    return parts.length > 0 ? parts.join(" · ") : "All reachable";
}

/**
 * What the records add up to, by the states of the record list's filter: a problem somewhere,
 * still under way, without a site, and with sites none of whose providers takes it.
 */
export interface RecordSummary {
    total: number;
    problems: number;
    /** Whether one of the problems is a write or a removal that failed, not only a change at a provider. */
    failed: boolean;
    inProgress: number;
    parked: number;
    noTarget: number;
}

/** Whether a write or a removal of the record failed somewhere -- red, where a change at a provider is amber. */
const hasFailed = (record: Pick<DnsRecord, "links">) => {
    const worst = worstState(record.links);
    return worst === "error" || worst === "removal_failed";
};

export function recordSummary(records: readonly Pick<DnsRecord, "links" | "siteIds">[]): RecordSummary {
    const summary: RecordSummary = { total: records.length, problems: 0, failed: false, inProgress: 0, parked: 0, noTarget: 0 };
    for (const record of records) {
        if (hasProblem(record)) {
            summary.problems++;
            if (hasFailed(record)) summary.failed = true;
        } else if (matchesStatus(record, "in_progress")) {
            summary.inProgress++;
        }
        if (isParked(record)) summary.parked++;
        else if (record.links.length === 0) summary.noTarget++;
    }
    return summary;
}

/** What the "Records" card says below its number. A part that is zero is left out. */
export function recordSummaryText({ total, problems, inProgress, parked, noTarget }: RecordSummary): string {
    if (total === 0) return "No record yet";
    const parts = [
        problems > 0 ? `${problems} with problems` : null,
        inProgress > 0 ? `${inProgress} in progress` : null,
        noTarget > 0 ? `${noTarget} at no provider` : null,
        parked > 0 ? `${parked} parked` : null,
    ].filter((part) => part !== null);
    return parts.length > 0 ? parts.join(" · ") : "All in sync";
}

/** One provider on a site's tile: its dot is how its last reading went. */
export interface SiteTileProvider {
    id: string;
    name: string;
    tone: StatusDotTone;
    /** Whether dpm writes to it. */
    writable: boolean;
}

/** One site on the dashboard: its providers and how its records stand. */
export interface SiteTile {
    id: string;
    name: string;
    records: number;
    problems: number;
    /** Whether one of the problems is a write or a removal that failed. */
    failed: boolean;
    providers: SiteTileProvider[];
}

/**
 * A tile per site in the order of the site list, its providers in the order of the provider
 * list. The record count is the site's own; the problems are counted from the records.
 */
export function siteTiles(
    sites: readonly Pick<Site, "id" | "name" | "providerIds" | "recordCount">[],
    providers: readonly Pick<Provider, "id" | "name" | "lastError" | "lastSeenAt" | "writable">[],
    records: readonly Pick<DnsRecord, "links" | "siteIds">[],
): SiteTile[] {
    return sites.map((site) => {
        const own = records.filter((r) => r.siteIds.includes(site.id) && hasProblem(r));
        return {
            id: site.id,
            name: site.name,
            records: site.recordCount,
            problems: own.length,
            failed: own.some(hasFailed),
            providers: providers
                .filter((p) => site.providerIds.includes(p.id))
                .map((p) => ({ id: p.id, name: p.name, tone: readTone(p), writable: p.writable })),
        };
    });
}

/** What a site's tile says at its foot. */
export function siteTileSummary({ records, problems, providers }: Pick<SiteTile, "records" | "problems" | "providers">): string {
    if (providers.length === 0) return records > 0 ? "No provider" : "No provider, no records";
    if (records === 0) return "No records";
    return problems > 0 ? `${plural(problems, "record")} with problems` : "All in sync";
}
