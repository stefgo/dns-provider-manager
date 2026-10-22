import type { RecordType } from "@dpm/shared";

/** A zone as a provider names it: its own id, and the domain. */
export interface ProviderZoneInfo {
    id: string;
    name: string;
}

/**
 * One A, AAAA or CNAME record a provider holds, in dpm's terms: the name and a CNAME's value
 * normalised, the TTL null where the provider leaves it to itself.
 */
export interface ProviderEntry {
    /** What the provider calls this record, for changing or deleting it later. */
    externalId: string;
    /** The zone it was read from, by id and name; null for a provider without zones. */
    zoneId: string | null;
    zone: string | null;
    name: string;
    type: RecordType;
    value: string;
    ttl: number | null;
    proxied: boolean;
}

/**
 * What dpm asks of a DNS server. Reading only, for now; each method throws an `Error` whose
 * message says in a sentence why it failed -- it is shown as it is.
 */
export interface DnsProviderClient {
    /** The zones the access sees. A provider without zones answers one with an empty id. */
    listZones(): Promise<ProviderZoneInfo[]>;
    /** The A, AAAA and CNAME records of one zone. Every other type is left out. */
    listRecords(zone: ProviderZoneInfo): Promise<ProviderEntry[]>;
}
