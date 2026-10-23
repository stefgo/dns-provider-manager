import db from "../core/Database.js";
import type { Site, SiteFields } from "@dpm/shared";

interface SiteRow {
    id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string | null;
    /** Not a column: a JSON array of the site's provider ids. */
    provider_ids: string;
    /** Not a column: how many records belong to the site. */
    record_count: number;
}

const SELECT_SITE = `
    SELECT s.*,
        (SELECT json_group_array(provider_id) FROM site_providers WHERE site_id = s.id) AS provider_ids,
        (SELECT COUNT(*) FROM record_sites WHERE site_id = s.id) AS record_count
    FROM sites s`;

/** A JSON array of ids out of a subquery; what does not read reads as empty. */
export function idsColumn(text: string | null): string[] {
    try {
        const value: unknown = JSON.parse(text ?? "[]");
        return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").sort() : [];
    } catch {
        return [];
    }
}

function rowToSite(row: SiteRow): Site {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        providerIds: idsColumn(row.provider_ids),
        recordCount: row.record_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

const replaceProviders = (siteId: string, providerIds: readonly string[]) => {
    db.prepare("DELETE FROM site_providers WHERE site_id = ?").run(siteId);
    const insert = db.prepare("INSERT INTO site_providers (site_id, provider_id) VALUES (?, ?)");
    for (const providerId of providerIds) insert.run(siteId, providerId);
};

export class SiteRepository {
    static findAll(): Site[] {
        const rows = db.prepare(`${SELECT_SITE} ORDER BY s.name COLLATE NOCASE`).all() as SiteRow[];
        return rows.map(rowToSite);
    }

    static findById(id: string): Site | undefined {
        const row = db.prepare(`${SELECT_SITE} WHERE s.id = ?`).get(id) as SiteRow | undefined;
        return row ? rowToSite(row) : undefined;
    }

    /** Whether another site than `exceptId` is called `name`, ignoring case. */
    static nameTaken(name: string, exceptId?: string): boolean {
        return (
            db.prepare("SELECT 1 FROM sites WHERE name = ? COLLATE NOCASE AND id != ?").get(name, exceptId ?? "") !==
            undefined
        );
    }

    /** One transaction: a site without the providers it was created with never shows. */
    static create(id: string, fields: SiteFields): void {
        db.transaction(() => {
            db.prepare("INSERT INTO sites (id, name, description, created_at) VALUES (?, ?, ?, ?)").run(
                id,
                fields.name,
                fields.description,
                new Date().toISOString(),
            );
            replaceProviders(id, fields.providerIds);
        })();
    }

    static update(id: string, fields: SiteFields): { changes: number } {
        return db.transaction(() => {
            const result = db
                .prepare("UPDATE sites SET name = ?, description = ?, updated_at = ? WHERE id = ?")
                .run(fields.name, fields.description, new Date().toISOString(), id);
            if (result.changes > 0) replaceProviders(id, fields.providerIds);
            return { changes: result.changes };
        })();
    }

    /** Takes the site away from its records, then deletes it. */
    static delete(id: string): { changes: number } {
        return db.transaction(() => {
            db.prepare("DELETE FROM record_sites WHERE site_id = ?").run(id);
            return { changes: db.prepare("DELETE FROM sites WHERE id = ?").run(id).changes };
        })();
    }
}
