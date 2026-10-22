import { normaliseDnsName } from "@dpm/shared";
import type { ProviderEntry, ProviderZoneInfo } from "../DnsProvider.js";
import { decodeDnsRecord } from "./dnsRecord.js";
import { isDomainNode } from "./sambaProtection.js";

/** A zone's id: its name, so two providers for one domain see the same zone. */
export const sambaZoneId = (name: string) => `ad:${name.toLowerCase()}`;

/** The full name of a node: `@` is the zone itself, every other name lies below it. */
export const nodeFqdn = (nodeName: string, zoneName: string) =>
    normaliseDnsName(nodeName === "@" ? zoneName : `${nodeName}.${zoneName}`);

/**
 * The A, AAAA and CNAME records of one `dnsNode`, as entries. A name of the domain's own
 * gives none (`isDomainNode`), and neither do the addresses under a domain controller's own
 * name -- the domain controller registers those itself. A tombstone, a value that does not
 * decode and any other type are left out.
 *
 * Identified by name, type and value: the directory gives a record no id of its own.
 */
export function entriesFromNode(
    zone: ProviderZoneInfo,
    nodeName: string,
    values: readonly Uint8Array[],
    dcHostNames: ReadonlySet<string>,
): ProviderEntry[] {
    if (isDomainNode(zone.name, nodeName)) return [];
    const name = nodeFqdn(nodeName, zone.name);
    const entries: ProviderEntry[] = [];
    for (const bytes of values) {
        const record = decodeDnsRecord(bytes);
        if (!record) continue;
        const { data } = record;
        let type: ProviderEntry["type"];
        let value: string;
        if (data.type === "A" || data.type === "AAAA") {
            if (dcHostNames.has(name)) continue;
            type = data.type;
            value = data.address.toLowerCase();
        } else if (data.type === "CNAME") {
            type = "CNAME";
            value = normaliseDnsName(data.target);
        } else {
            continue;
        }
        entries.push({
            externalId: `${type} ${name} ${value}`,
            zoneId: zone.id,
            zone: zone.name,
            name,
            type,
            value,
            ttl: record.ttl > 0 ? record.ttl : null,
            proxied: false,
        });
    }
    return entries;
}
