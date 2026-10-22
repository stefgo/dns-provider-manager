import { isInZone, type ProviderType, type SkippedProvider } from "@dpm/shared";
import { CAPABILITIES, type ProviderZoneInfo } from "../providers/DnsProvider.js";

/** What the decision needs of a provider. */
export interface TargetProvider {
    id: string;
    name: string;
    type: ProviderType;
    /** Its zones with who uses each, as `ProviderRepository` derives it. */
    zones: readonly { id: string; name: string; owner: string | null }[];
    /** Null while it was never read: its zones are not known yet. */
    lastSeenAt: string | null;
}

export interface TargetSite {
    id: string;
    name: string;
    providerIds: readonly string[];
}

/** A provider a record goes to, and the zone it goes into there (null without zones). */
export interface Target {
    providerId: string;
    zone: ProviderZoneInfo | null;
}

export interface RecordTargets {
    targets: Target[];
    /** The providers of its sites that do not get it, with the reason. */
    skipped: SkippedProvider[];
    /** Why the record cannot be stored at all: a site that has providers, none of which takes it. */
    refusal: string | null;
}

/**
 * Which providers a record goes to, site by site:
 *
 * - A provider without zones (AdGuard Home) takes every name.
 * - Among the providers with zones, the one whose used zone holds the name gets it -- with
 *   nested zones the longest one. A record goes to at most one provider with zones per site.
 * - A provider whose zones were never read is waited for rather than passed over.
 *
 * A site whose providers all have zones and none of them holds the name is a refusal: the
 * record would go nowhere there. Next to an AdGuard Home it is not -- the record goes there,
 * and the provider with zones is shown as skipped.
 */
export function recordTargets(
    record: { name: string; siteIds: readonly string[] },
    sites: readonly TargetSite[],
    providers: readonly TargetProvider[],
): RecordTargets {
    const targets = new Map<string, Target>();
    const skipped = new Map<string, string>();
    let refusal: string | null = null;

    for (const site of sites.filter((s) => record.siteIds.includes(s.id))) {
        const members = site.providerIds
            .map((id) => providers.find((p) => p.id === id))
            .filter((p): p is TargetProvider => p !== undefined);
        const flat = members.filter((p) => !CAPABILITIES[p.type].zoned);
        const zoned = members.filter((p) => CAPABILITIES[p.type].zoned);
        const unread = (p: TargetProvider) => p.lastSeenAt === null && p.zones.length === 0;

        for (const provider of flat) targets.set(provider.id, { providerId: provider.id, zone: null });

        let best: { provider: TargetProvider; zone: ProviderZoneInfo } | null = null;
        for (const provider of zoned) {
            for (const zone of provider.zones) {
                if (zone.owner !== provider.id || !isInZone(record.name, zone.name)) continue;
                if (!best || zone.name.length > best.zone.name.length) best = { provider, zone: { id: zone.id, name: zone.name } };
            }
        }
        if (best) targets.set(best.provider.id, { providerId: best.provider.id, zone: best.zone });

        for (const provider of zoned) {
            if (provider === best?.provider || skipped.has(provider.id)) continue;
            skipped.set(
                provider.id,
                unread(provider)
                    ? "Its zones have not been read yet"
                    : best
                        ? `Goes to ${best.provider.name} instead, whose zone ${best.zone.name} is closer`
                        : "Lies in none of the zones it uses",
            );
        }

        if (refusal === null && members.length > 0 && flat.length === 0 && !best && !zoned.some(unread)) {
            refusal = `${record.name} lies in none of the zones the site "${site.name}" writes to`;
        }
    }

    return {
        targets: [...targets.values()],
        skipped: [...skipped].filter(([id]) => !targets.has(id)).map(([providerId, reason]) => ({ providerId, reason })),
        refusal,
    };
}
