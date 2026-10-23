import type { DnsRecord, Provider, RecordSitesResult, Site } from "@dpm/shared";
import { plural } from "../../../utils";

/** How many of the picked records have a site: every one, some of them, or none. */
export type SiteState = "all" | "some" | "none";

/** Each site's state among the records as they are -- what the dialog starts from. */
export function initialSiteStates(
    records: readonly Pick<DnsRecord, "siteIds">[],
    sites: readonly Pick<Site, "id">[],
): Record<string, SiteState> {
    const states: Record<string, SiteState> = {};
    for (const site of sites) {
        const having = records.filter((r) => r.siteIds.includes(site.id)).length;
        states[site.id] = having === 0 ? "none" : having === records.length ? "all" : "some";
    }
    return states;
}

/**
 * The state after a click on a site's box: on and off in turn. A site only some of the
 * records have comes back to "some" after both, so that it can be left as it is again.
 */
export function nextSiteState(current: SiteState, initial: SiteState): SiteState {
    if (current === "some") return "all";
    if (current === "all") return "none";
    return initial === "some" ? "some" : "all";
}

/** What the dialog asks for: the sites now on that were not, and the ones now off that were. */
export function siteChanges(
    states: Readonly<Record<string, SiteState>>,
    initial: Readonly<Record<string, SiteState>>,
): { add: string[]; remove: string[] } {
    const changed = Object.keys(states).filter((id) => states[id] !== initial[id]);
    return {
        add: changed.filter((id) => states[id] === "all"),
        remove: changed.filter((id) => states[id] === "none"),
    };
}

/** A record's sites once `add` and `remove` are applied, as the server applies them. */
export const sitesAfter = (siteIds: readonly string[], add: readonly string[], remove: readonly string[]): string[] =>
    [...new Set([...siteIds, ...add])].filter((id) => !remove.includes(id));

const providersOf = (siteIds: readonly string[], sites: readonly Pick<Site, "id" | "providerIds">[]) =>
    new Set(sites.filter((s) => siteIds.includes(s.id)).flatMap((s) => s.providerIds));

export interface SitesChangePreview {
    /** The records whose sites change. */
    changed: number;
    /** The records that have their sites as asked already. */
    unchanged: number;
    /** By name, the providers some of the records are newly written to. */
    writtenTo: string[];
    /** By name, the providers some of the records are removed from. */
    removedFrom: string[];
    /** The records left without a site, and so parked. */
    parked: number;
}

/**
 * What the change would do, as far as the browser can tell: which records change, which
 * providers get or lose some of them, and which are parked. A provider dpm only reads gets
 * nothing written and nothing removed. Whether the server takes each record is its to say.
 */
export function sitesChangePreview(
    records: readonly Pick<DnsRecord, "siteIds">[],
    sites: readonly Pick<Site, "id" | "providerIds">[],
    providers: readonly Pick<Provider, "id" | "name" | "writable">[],
    add: readonly string[],
    remove: readonly string[],
): SitesChangePreview {
    const gained = new Set<string>();
    const lost = new Set<string>();
    let changed = 0;
    let parked = 0;
    for (const record of records) {
        const after = sitesAfter(record.siteIds, add, remove);
        const same = after.length === record.siteIds.length && after.every((id) => record.siteIds.includes(id));
        if (same) continue;
        changed++;
        if (after.length === 0) parked++;
        const before = providersOf(record.siteIds, sites);
        const now = providersOf(after, sites);
        for (const id of now) if (!before.has(id)) gained.add(id);
        for (const id of before) if (!now.has(id)) lost.add(id);
    }
    const names = (ids: Set<string>) => providers.filter((p) => p.writable && ids.has(p.id)).map((p) => p.name);
    return { changed, unchanged: records.length - changed, writtenTo: names(gained), removedFrom: names(lost), parked };
}

/** What a toast says after the change: how many records changed, and every refusal with its reason. */
export function sitesOutcome(result: RecordSitesResult): { variant: "success" | "warning" | "error"; title: string; description?: string } {
    const changed = result.changed.length;
    const title = changed === 0 ? "No record was changed" : `Sites of ${plural(changed, "record")} changed`;
    if (result.refused.length === 0) return { variant: changed === 0 ? "warning" : "success", title };
    return {
        variant: changed === 0 ? "error" : "warning",
        title,
        description: result.refused.map((r) => `${[r.name, r.type, r.value].filter(Boolean).join(" ")}: ${r.reason}`).join("\n"),
    };
}
