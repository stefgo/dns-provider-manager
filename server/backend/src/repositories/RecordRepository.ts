import db from "../core/Database.js";
import { RECORD_TYPES, type DnsRecord, type RecordFields, type RecordType } from "@dpm/shared";
import { idsColumn } from "./SiteRepository.js";

/** A record as stored: without where it stands at its providers, which `SyncService` adds. */
export type StoredRecord = Omit<DnsRecord, "links" | "skipped">;

interface RecordRow {
    id: string;
    name: string;
    type: string;
    value: string;
    ttl: number | null;
    proxied: number;
    note: string;
    created_at: string;
    created_by: string | null;
    updated_at: string | null;
    updated_by: string | null;
    /** Not a column: a JSON array of the record's site ids. */
    site_ids: string;
}

const SELECT_RECORD = `
    SELECT r.*,
        (SELECT json_group_array(site_id) FROM record_sites WHERE record_id = r.id) AS site_ids
    FROM records r`;

/** A row of a type this build does not manage is left out rather than shown as another. */
function rowToRecord(row: RecordRow): StoredRecord | null {
    if (!(RECORD_TYPES as readonly string[]).includes(row.type)) return null;
    return {
        id: row.id,
        name: row.name,
        type: row.type as RecordType,
        value: row.value,
        ttl: row.ttl,
        proxied: row.proxied === 1,
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
                INSERT INTO records (id, name, type, value, ttl, proxied, note, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                fields.name,
                fields.type,
                fields.value,
                fields.ttl,
                fields.proxied ? 1 : 0,
                fields.note,
                new Date().toISOString(),
                user,
            );
            replaceSites(id, fields.siteIds);
        })();
    }

    static update(id: string, fields: RecordFields, user: string | null): { changes: number } {
        return db.transaction(() => {
            const result = db
                .prepare(`
                    UPDATE records
                    SET name = ?, type = ?, value = ?, ttl = ?, proxied = ?, note = ?, updated_at = ?, updated_by = ?
                    WHERE id = ?
                `)
                .run(
                    fields.name,
                    fields.type,
                    fields.value,
                    fields.ttl,
                    fields.proxied ? 1 : 0,
                    fields.note,
                    new Date().toISOString(),
                    user,
                    id,
                );
            if (result.changes > 0) replaceSites(id, fields.siteIds);
            return { changes: result.changes };
        })();
    }

    static delete(id: string): { changes: number } {
        return db.prepare("DELETE FROM records WHERE id = ?").run(id);
    }
}
