import db from "../core/Database.js";
import { RECORD_TYPES, type DnsRecord, type RecordFields, type RecordSetting, type RecordType } from "@dpm/shared";
import { idsColumn } from "./SiteRepository.js";

/** A record as stored: without where it stands at its providers, which `SyncService` adds. */
export type StoredRecord = Omit<DnsRecord, "links" | "skipped">;

interface RecordRow {
    id: string;
    name: string;
    type: string;
    value: string;
    note: string;
    created_at: string;
    created_by: string | null;
    updated_at: string | null;
    updated_by: string | null;
    /** Not a column: a JSON array of the record's site ids. */
    site_ids: string;
    /** Not a column: a JSON array of its settings per provider. */
    settings: string;
}

const SELECT_RECORD = `
    SELECT r.*,
        (SELECT json_group_array(site_id) FROM record_sites WHERE record_id = r.id) AS site_ids,
        (SELECT json_group_array(json_object('providerId', provider_id, 'ttl', ttl, 'proxied', proxied))
            FROM (SELECT * FROM record_settings WHERE record_id = r.id ORDER BY provider_id)) AS settings
    FROM records r`;

/** The settings column; SQLite's 0 and 1 become a boolean. */
function settingsColumn(json: string): RecordSetting[] {
    const rows = JSON.parse(json) as { providerId: string; ttl: number | null; proxied: number }[];
    return rows.map((row) => ({ providerId: row.providerId, ttl: row.ttl, proxied: row.proxied === 1 }));
}

/** A row of a type this build does not manage is left out rather than shown as another. */
function rowToRecord(row: RecordRow): StoredRecord | null {
    if (!(RECORD_TYPES as readonly string[]).includes(row.type)) return null;
    return {
        id: row.id,
        name: row.name,
        type: row.type as RecordType,
        value: row.value,
        settings: settingsColumn(row.settings),
        note: row.note,
        siteIds: idsColumn(row.site_ids),
        createdAt: row.created_at,
        createdBy: row.created_by,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
    };
}

const replaceSites = (recordId: string, siteIds: readonly string[]) => {
    db.prepare("DELETE FROM record_sites WHERE record_id = ?").run(recordId);
    const insert = db.prepare("INSERT INTO record_sites (record_id, site_id) VALUES (?, ?)");
    for (const siteId of siteIds) insert.run(recordId, siteId);
};

/** Only what differs from the provider's defaults is stored. */
const replaceSettings = (recordId: string, settings: readonly RecordSetting[]) => {
    db.prepare("DELETE FROM record_settings WHERE record_id = ?").run(recordId);
    const insert = db.prepare("INSERT INTO record_settings (record_id, provider_id, ttl, proxied) VALUES (?, ?, ?, ?)");
    for (const s of settings) {
        if (s.ttl !== null || s.proxied) insert.run(recordId, s.providerId, s.ttl, s.proxied ? 1 : 0);
    }
};

export class RecordRepository {
    /** Ordered by name, then type and value, so the records of one name stand together. */
    static findAll(): StoredRecord[] {
        const rows = db.prepare(`${SELECT_RECORD} ORDER BY r.name, r.type, r.value`).all() as RecordRow[];
        return rows.map(rowToRecord).filter((r): r is StoredRecord => r !== null);
    }

    static findById(id: string): StoredRecord | undefined {
        const row = db.prepare(`${SELECT_RECORD} WHERE r.id = ?`).get(id) as RecordRow | undefined;
        return (row && rowToRecord(row)) ?? undefined;
    }

    /** One transaction: a record without its sites never shows. */
    static create(id: string, fields: RecordFields, user: string | null): void {
        db.transaction(() => {
            db.prepare(`
                INSERT INTO records (id, name, type, value, note, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(id, fields.name, fields.type, fields.value, fields.note, new Date().toISOString(), user);
            replaceSites(id, fields.siteIds);
            replaceSettings(id, fields.settings);
        })();
    }

    static update(id: string, fields: RecordFields, user: string | null): { changes: number } {
        return db.transaction(() => {
            const result = db
                .prepare(`
                    UPDATE records
                    SET name = ?, type = ?, value = ?, note = ?, updated_at = ?, updated_by = ?
                    WHERE id = ?
                `)
                .run(fields.name, fields.type, fields.value, fields.note, new Date().toISOString(), user, id);
            if (result.changes > 0) {
                replaceSites(id, fields.siteIds);
                replaceSettings(id, fields.settings);
            }
            return { changes: result.changes };
        })();
    }

    static delete(id: string): { changes: number } {
        return db.prepare("DELETE FROM records WHERE id = ?").run(id);
    }
}
