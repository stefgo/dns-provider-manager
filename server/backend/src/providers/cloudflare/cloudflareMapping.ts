import { RECORD_TYPES, normaliseDnsName, type RecordType } from "@dpm/shared";
import type { ProviderEntry, RecordData } from "../DnsProvider.js";

/** A DNS record as Cloudflare's API returns it, as far as dpm reads it. */
export interface CloudflareRecord {
    id: string;
    name: string;
    type: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
}

/** A Cloudflare zone, as far as dpm reads it. */
export interface CloudflareZone {
    id: string;
    name: string;
}

/**
 * A Cloudflare record as an entry, or null for a type dpm does not manage. TTL 1 is
 * Cloudflare's "Auto", which is what dpm calls the provider's own default.
 */
export function entryFromCloudflare(record: CloudflareRecord, zone: CloudflareZone): ProviderEntry | null {
    if (!(RECORD_TYPES as readonly string[]).includes(record.type)) return null;
    const type = record.type as RecordType;
    return {
        externalId: record.id,
        zoneId: zone.id,
        zone: zone.name,
        name: normaliseDnsName(record.name),
        type,
        value: type === "CNAME" ? normaliseDnsName(record.content) : record.content.trim().toLowerCase(),
        ttl: record.ttl === undefined || record.ttl === 1 ? null : record.ttl,
        proxied: record.proxied === true,
        disabled: false,
    };
}

/**
 * The body of a `POST` or `PATCH`. No TTL is Cloudflare's "Auto" (1). `comment` and `tags` are
 * left out, so a `PATCH` keeps what someone noted there.
 */
export function cloudflareBody(record: RecordData): Record<string, unknown> {
    return { type: record.type, name: record.name, content: record.value, ttl: record.ttl ?? 1, proxied: record.proxied };
}

/** The errors of a refused call, as one sentence: `Authentication error (10000)`. */
export function cloudflareErrors(body: unknown): string | null {
    const errors = (body as { errors?: unknown } | null)?.errors;
    if (!Array.isArray(errors) || errors.length === 0) return null;
    return errors
        .map((e: { message?: unknown; code?: unknown }) =>
            typeof e?.message === "string" ? `${e.message}${typeof e.code === "number" ? ` (${e.code})` : ""}` : null,
        )
        .filter((text): text is string => text !== null)
        .join("; ");
}
