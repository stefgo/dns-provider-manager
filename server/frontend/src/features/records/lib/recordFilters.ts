import type { DnsRecord, Site } from "@dpm/shared";
import { hasProblem, worstState } from "./recordSync";

/** Every site, the records without one, or the id of one site. */
export type SiteFilter = "all" | "parked" | (string & {});

/**
 * Every state, or one of three the record's badge falls into: in sync at every provider, a
 * problem somewhere, or still under way -- not written yet, or being removed. A record that
 * goes to no provider is in none of the three.
 */
export type StatusFilter = "all" | "in_sync" | "problems" | "in_progress";

/** A record without a site: dpm keeps it and writes it to no provider. */
export const isParked = (record: Pick<DnsRecord, "siteIds">) => record.siteIds.length === 0;

/** The site filter a query parameter names; one that names no site (any longer) is every site. */
export function parseSiteFilter(value: string, sites: readonly Pick<Site, "id">[]): SiteFilter {
    if (value === "parked" || sites.some((s) => s.id === value)) return value;
    return "all";
}

const STATUS_FILTERS: readonly StatusFilter[] = ["all", "in_sync", "problems", "in_progress"];

/** The status filter a query parameter names; an unknown one is every state. */
export const parseStatusFilter = (value: string): StatusFilter =>
    STATUS_FILTERS.find((f) => f === value) ?? "all";

export function matchesSite(record: Pick<DnsRecord, "siteIds">, filter: SiteFilter): boolean {
    if (filter === "all") return true;
    if (filter === "parked") return isParked(record);
    return record.siteIds.includes(filter);
}

export function matchesStatus(record: Pick<DnsRecord, "links">, filter: StatusFilter): boolean {
    if (filter === "all") return true;
    if (filter === "problems") return hasProblem(record);
    const worst = worstState(record.links);
    if (filter === "in_sync") return worst === "in_sync";
    return worst === "pending" || worst === "removing";
}

/** The choices of the site filter: every site, each site in the order of the site list, the parked records. */
export const siteFilterOptions = (sites: readonly Pick<Site, "id" | "name">[]) => [
    { value: "all", label: "All sites" },
    ...sites.map((s) => ({ value: s.id, label: s.name })),
    { value: "parked", label: "Parked" },
];

/** The choices of the status filter. */
export const statusFilterOptions = (): { value: StatusFilter; label: string }[] => [
    { value: "all", label: "All states" },
    { value: "in_sync", label: "In sync" },
    { value: "problems", label: "Problems" },
    { value: "in_progress", label: "Work in Progress" },
];
