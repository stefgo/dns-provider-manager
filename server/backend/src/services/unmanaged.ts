import { dnsNameError, recordValueError, type DnsRecord, type Provider, type Site, type UnmanagedEntry } from "@dpm/shared";
import type { ProviderEntry } from "../providers/DnsProvider.js";
import { claimKey } from "./syncPlan.js";

/**
 * The entries the providers hold that dpm does not manage there.
 *
 * An entry is managed when a record holds it (`claimed`: dpm wrote it, took it over, or sees
 * it as what one of its records drifted to). Before the first comparison, one whose name,
 * type and value a record in a site of that provider has counts as managed as well: that
 * record is meant for this provider, and this entry is it. A rewrite switched off in AdGuard
 * Home answers nothing and is left out.
 * Everything else is unmanaged -- also an entry whose record dpm has, but in other sites
 * only; adopting it gives that record the site.
 *
 * Only the zones a provider uses count. A zone another provider took over since the last
 * reading is that one's, even before this one is read again.
 */
export function unmanagedEntries(
    readings: ReadonlyMap<string, readonly ProviderEntry[]>,
    providers: readonly Pick<Provider, "id" | "zones">[],
    records: readonly Pick<DnsRecord, "id" | "name" | "type" | "value" | "siteIds">[],
    sites: readonly Pick<Site, "id" | "providerIds">[],
    claimed: ReadonlySet<string> = new Set(),
): UnmanagedEntry[] {
    const result: UnmanagedEntry[] = [];
    for (const provider of providers) {
        const entries = readings.get(provider.id) ?? [];
        const ownSites = new Set(sites.filter((s) => s.providerIds.includes(provider.id)).map((s) => s.id));
        for (const entry of entries) {
            if (entry.disabled || claimed.has(claimKey(provider.id, entry.externalId))) continue;
            if (entry.zoneId !== null && provider.zones.find((z) => z.id === entry.zoneId)?.owner !== provider.id) continue;
            const record = records.find((r) => r.name === entry.name && r.type === entry.type && r.value === entry.value);
            if (record && record.siteIds.some((id) => ownSites.has(id))) continue;
            result.push({
                providerId: provider.id,
                externalId: entry.externalId,
                zone: entry.zone,
                name: entry.name,
                type: entry.type,
                value: entry.value,
                ttl: entry.ttl,
                proxied: entry.proxied,
                recordId: record?.id ?? null,
                problem: dnsNameError(entry.name, { wildcard: true }) ?? recordValueError(entry.type, entry.value, entry.name),
            });
        }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
}
