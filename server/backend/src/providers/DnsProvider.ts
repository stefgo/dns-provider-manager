import type { ProviderType, RecordType } from "@dpm/shared";

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
    /** Held but switched off (AdGuard Home): it answers nothing, and is never unmanaged. */
    disabled: boolean;
}

/** What dpm writes: a record as it stands in dpm, in the same terms as an entry. */
export interface RecordData {
    name: string;
    type: RecordType;
    value: string;
    ttl: number | null;
    proxied: boolean;
}

/** Which entry a change or a deletion is meant for. */
export type EntryRef = Pick<ProviderEntry, "externalId" | "zoneId" | "zone">;

/**
 * What a type of provider knows besides name, type and value. A field it does not know is
 * neither written nor compared: AdGuard Home has no TTL, and only Cloudflare proxies.
 */
export interface ProviderCapabilities {
    /** Records live in zones, and a record goes to the provider whose zone holds its name. */
    zoned: boolean;
    ttl: boolean;
    proxied: boolean;
}

export const CAPABILITIES: Record<ProviderType, ProviderCapabilities> = {
    cloudflare: { zoned: true, ttl: true, proxied: true },
    adguard: { zoned: false, ttl: false, proxied: false },
    "samba-ad": { zoned: true, ttl: true, proxied: false },
};

/**
 * What dpm asks of a DNS server. Each method throws an `Error` whose message says in a
 * sentence why it failed -- it is shown as it is.
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
    /** Writes a new entry into `zone` (null without zones) and answers it as the provider holds it now. */
    create(zone: ProviderZoneInfo | null, record: RecordData): Promise<ProviderEntry>;
    /** Changes the entry `target` names into `record`, and answers it as the provider holds it now. */
    update(target: EntryRef, record: RecordData): Promise<ProviderEntry>;
    /** Removes the entry `target` names. An entry that is gone already counts as removed. */
    delete(target: EntryRef): Promise<void>;
    close(): Promise<void>;
}
