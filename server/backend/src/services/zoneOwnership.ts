/** What the decision needs of a provider. */
export interface OwnershipProvider {
    id: string;
    createdAt: string;
    /** `all` uses every zone it sees, `selected` the ones ticked. Types without zones: `all`. */
    zoneMode: "all" | "selected";
}

/** A zone as one provider sees it. */
export interface OwnershipZone {
    providerId: string;
    zoneId: string;
    selected: boolean;
}

/**
 * Which provider uses each zone, by zone id. A zone is used by at most one provider, so two
 * tokens that see the same zone never both write to it.
 *
 * - A provider under "Selected zones" claims only what is ticked; one under "All zones"
 *   claims everything it sees.
 * - A zone ticked explicitly wins over one that is merely seen: choosing a zone for one
 *   provider is how it is taken away from another.
 * - Otherwise the provider created first keeps it -- a token added later does not take over
 *   what an older one already writes to.
 *
 * Derived, never stored: it follows from the zones and the modes whenever it is asked.
 */
export function zoneOwnership(
    providers: readonly OwnershipProvider[],
    zones: readonly OwnershipZone[],
): Map<string, string> {
    const byId = new Map(providers.map((p) => [p.id, p]));
    const rank = (zone: OwnershipZone): [number, string, string] | null => {
        const provider = byId.get(zone.providerId);
        if (!provider) return null;
        if (provider.zoneMode === "selected") return zone.selected ? [0, provider.createdAt, provider.id] : null;
        return [1, provider.createdAt, provider.id];
    };
    const best = new Map<string, [number, string, string]>();
    for (const zone of zones) {
        const candidate = rank(zone);
        if (!candidate) continue;
        const current = best.get(zone.zoneId);
        if (
            !current ||
            candidate[0] < current[0] ||
            (candidate[0] === current[0] && (candidate[1] < current[1] || (candidate[1] === current[1] && candidate[2] < current[2])))
        ) {
            best.set(zone.zoneId, candidate);
        }
    }
    return new Map([...best].map(([zoneId, [, , providerId]]) => [zoneId, providerId]));
}
