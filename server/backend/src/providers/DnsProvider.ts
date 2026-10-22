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
 *
 * A client may keep a connection open between its calls; `close` ends it. One client serves
 * one reading or one test, and is closed after it.
 */
export interface DnsProviderClient {
    /**
     * Whether the server has zones. Without, `listZones` answers none and `listRecords` is
     * asked once, without a zone, for everything it holds.
     */
    readonly zoned: boolean;
    /** Asks whether the server answers, and says what it found, in a sentence. */
    test(): Promise<string>;
    /** The zones the access sees. */
    listZones(): Promise<ProviderZoneInfo[]>;
    /** The A, AAAA and CNAME records of one zone, or of everything for a server without zones. */
    listRecords(zone: ProviderZoneInfo | null): Promise<ProviderEntry[]>;
    close(): Promise<void>;
}
