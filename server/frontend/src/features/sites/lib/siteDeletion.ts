import type { DnsRecord } from "@dpm/shared";

/**
 * What deleting a site would do to its records: the names of those that belong to it alone,
 * which block the deletion, and how many keep another site.
 */
export function siteDeletion(
    siteId: string,
    records: readonly Pick<DnsRecord, "name" | "siteIds">[],
): { alone: string[]; shared: number } {
    const own = records.filter((r) => r.siteIds.includes(siteId));
    const alone = own.filter((r) => r.siteIds.length === 1).map((r) => r.name);
    return { alone: [...new Set(alone)].sort(), shared: own.length - alone.length };
}
