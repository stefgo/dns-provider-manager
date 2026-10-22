/**
 * Which names and records of a zone belong to the domain itself, as samba-ad-manager decides
 * it: the ones the domain controllers register for themselves. dpm neither lists nor adopts
 * them -- a wrong one takes the domain down, and the domain controller would put it back.
 */

/** The names every DNS server of the domain answers under: the DNS partitions themselves. */
const PARTITION_NAMES = new Set(["domaindnszones", "forestdnszones"]);

/**
 * A name of the domain's own: `@` (the zone itself), a name with a label that starts with
 * `_` (`_ldap._tcp`, `_msdcs` and what is below), `DomainDnsZones`, `ForestDnsZones`, `gc`,
 * and every name of the zone `_msdcs.<forest>`.
 */
export function isDomainNode(zoneName: string, nodeName: string): boolean {
    if (nodeName === "@") return true;
    if (zoneName.toLowerCase().startsWith("_msdcs.")) return true;
    const labels = nodeName.toLowerCase().split(".");
    if (labels.some((label) => label.startsWith("_"))) return true;
    const last = labels[labels.length - 1];
    return PARTITION_NAMES.has(last) || (labels.length === 1 && last === "gc");
}

/** Zones that are in the directory and are no zone of the domain, or hold nothing dpm manages. */
export function isSkippedZone(name: string): boolean {
    const lower = name.toLowerCase();
    return (
        lower === "rootdnsservers" ||
        lower.startsWith("..") ||
        lower.startsWith("_msdcs.") ||
        lower.endsWith(".in-addr.arpa") ||
        lower.endsWith(".ip6.arpa")
    );
}
