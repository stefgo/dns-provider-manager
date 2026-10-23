import db from "../core/Database.js";
import { LINK_STATUSES, RECORD_TYPES, type LinkStatus } from "@dpm/shared";
import type { ProviderEntry, RecordData } from "../providers/DnsProvider.js";

/** What a provider holds in place of what dpm wrote, with the entry's own id. */
export type Observed = Pick<ProviderEntry, "externalId" | "name" | "value" | "ttl" | "proxied" | "disabled">;

/** One record at one provider. See `03_record_links.ts`. */
export interface RecordLink {
    recordId: string;
    providerId: string;
    zoneId: string | null;
    externalId: string | null;
    written: RecordData | null;
    status: LinkStatus;
    error: string | null;
    observed: Observed | null;
    attempts: number;
    lastAttemptAt: string | null;
    syncedAt: string | null;
}

interface LinkRow {
    record_id: string;
    provider_id: string;
    zone_id: string | null;
    external_id: string | null;
    written: string | null;
    status: string;
    error: string | null;
    observed: string | null;
    attempts: number;
    last_attempt_at: string | null;
    synced_at: string | null;
}

function json(text: string | null): Record<string, unknown> | null {
    if (text === null) return null;
    try {
        const value: unknown = JSON.parse(text);
        return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** Only ever written by this repository; a column that does not read is taken as not there. */
function writtenOf(text: string | null): RecordData | null {
    const value = json(text);
    if (!value || typeof value.name !== "string" || typeof value.value !== "string") return null;
    if (!(RECORD_TYPES as readonly unknown[]).includes(value.type)) return null;
    return {
        name: value.name,
        type: value.type as RecordData["type"],
        value: value.value,
        ttl: typeof value.ttl === "number" ? value.ttl : null,
        proxied: value.proxied === true,
    };
}

function observedOf(text: string | null): Observed | null {
    const value = json(text);
    if (!value || typeof value.externalId !== "string" || typeof value.name !== "string" || typeof value.value !== "string") return null;
    return {
        externalId: value.externalId,
        name: value.name,
        value: value.value,
        ttl: typeof value.ttl === "number" ? value.ttl : null,
        proxied: value.proxied === true,
        disabled: value.disabled === true,
    };
}

const rowToLink = (row: LinkRow): RecordLink => ({
    recordId: row.record_id,
    providerId: row.provider_id,
    zoneId: row.zone_id,
    externalId: row.external_id,
    written: writtenOf(row.written),
    status: (LINK_STATUSES as readonly string[]).includes(row.status) ? (row.status as LinkStatus) : "pending",
    error: row.error,
    observed: observedOf(row.observed),
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    syncedAt: row.synced_at,
});

const writtenText = (written: RecordData | null) =>
    written && JSON.stringify({ name: written.name, type: written.type, value: written.value, ttl: written.ttl, proxied: written.proxied });

const observedText = (observed: Observed | null) =>
    observed &&
    JSON.stringify({
        externalId: observed.externalId,
        name: observed.name,
        value: observed.value,
        ttl: observed.ttl,
        proxied: observed.proxied,
        disabled: observed.disabled,
    });

export class RecordLinkRepository {
    static findAll(): RecordLink[] {
        return (db.prepare("SELECT * FROM record_links").all() as LinkRow[]).map(rowToLink);
    }

    static findByRecord(recordId: string): RecordLink[] {
        return (db.prepare("SELECT * FROM record_links WHERE record_id = ?").all(recordId) as LinkRow[]).map(rowToLink);
    }

    static find(recordId: string, providerId: string): RecordLink | undefined {
        const row = db.prepare("SELECT * FROM record_links WHERE record_id = ? AND provider_id = ?").get(recordId, providerId) as
            | LinkRow
            | undefined;
        return row && rowToLink(row);
    }

    /** The links whose record is gone: removals the providers have not done yet. */
    static findOrphans(): RecordLink[] {
        return (
            db.prepare("SELECT * FROM record_links WHERE record_id NOT IN (SELECT id FROM records)").all() as LinkRow[]
        ).map(rowToLink);
    }

    /** Writes the link as given, in place of the one there. */
    static save(link: RecordLink): void {
        db.prepare(`
            INSERT INTO record_links
                (record_id, provider_id, zone_id, external_id, written, status, error, observed, attempts, last_attempt_at, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (record_id, provider_id) DO UPDATE SET
                zone_id = excluded.zone_id, external_id = excluded.external_id, written = excluded.written,
                status = excluded.status, error = excluded.error, observed = excluded.observed,
                attempts = excluded.attempts, last_attempt_at = excluded.last_attempt_at, synced_at = excluded.synced_at
        `).run(
            link.recordId,
            link.providerId,
            link.zoneId,
            link.externalId,
            writtenText(link.written),
            link.status,
            link.error,
            observedText(link.observed),
            link.attempts,
            link.lastAttemptAt,
            link.syncedAt,
        );
    }

    static delete(recordId: string, providerId: string): void {
        db.prepare("DELETE FROM record_links WHERE record_id = ? AND provider_id = ?").run(recordId, providerId);
    }

    static deleteByRecord(recordId: string): void {
        db.prepare("DELETE FROM record_links WHERE record_id = ?").run(recordId);
    }
}
