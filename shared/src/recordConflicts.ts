import type { RecordType } from "./types.js";

/** What the check needs of a record: who it is, what it says, and where it goes. */
export interface ConflictRecord {
    /** Absent for a record that is about to be created. */
    id?: string;
    name: string;
    type: RecordType;
    value: string;
    siteIds: readonly string[];
}

export interface ConflictSite {
    id: string;
    name: string;
    providerIds: readonly string[];
}

export interface ConflictProvider {
    id: string;
    name: string;
}

/**
 * Where two records would be answered by the same DNS server: a site both belong to, or
 * else a provider that two of their sites share. Null when they never meet -- the same name
 * in `internal` and `external` with two answers is split horizon, not a conflict.
 */
function meetingPoint(
    a: readonly string[],
    b: readonly string[],
    sites: readonly ConflictSite[],
    providers: readonly ConflictProvider[],
): string | null {
    const site = a.find((id) => b.includes(id));
    if (site !== undefined) return `the site "${sites.find((s) => s.id === site)?.name ?? site}"`;

    const providersOf = (siteIds: readonly string[]) =>
        new Set(sites.filter((s) => siteIds.includes(s.id)).flatMap((s) => s.providerIds));
    const left = providersOf(a);
    const shared = [...providersOf(b)].find((id) => left.has(id));
    if (shared === undefined) return null;
    return `the provider "${providers.find((p) => p.id === shared)?.name ?? shared}"`;
}

/**
 * Why `candidate` cannot be stored next to `records`, or null. Checked before a record is
 * saved, so a conflict is refused here rather than by a provider later on.
 *
 * - The same name, type and value twice is one record: it gets another site instead.
 * - A CNAME stands alone. Wherever it is answered -- a site, or a provider two sites share
 *   -- no other record of its name may be answered as well, whatever its type.
 *
 * Several A or AAAA records of one name are allowed: that is round robin.
 */
export function recordConflict(
    candidate: ConflictRecord,
    records: readonly ConflictRecord[],
    sites: readonly ConflictSite[],
    providers: readonly ConflictProvider[] = [],
): string | null {
    for (const other of records) {
        if (other.id !== undefined && other.id === candidate.id) continue;
        if (other.name !== candidate.name) continue;

        if (other.type === candidate.type && other.value === candidate.value) {
            return `${candidate.name} ${candidate.type} ${candidate.value} exists already; add the site to that record instead`;
        }
        if (candidate.type !== "CNAME" && other.type !== "CNAME") continue;

        const where = meetingPoint(candidate.siteIds, other.siteIds, sites, providers);
        if (where === null) continue;
        const existing = other.type === "CNAME" ? `a CNAME to ${other.value}` : `an ${other.type} record`;
        return `${candidate.name} has ${existing} in ${where} already, and a CNAME cannot stand beside another record of its name`;
    }
    return null;
}
