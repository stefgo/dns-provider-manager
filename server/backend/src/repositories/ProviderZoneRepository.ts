import db from "../core/Database.js";
import type { ProviderZoneInfo } from "../providers/DnsProvider.js";
import type { OwnershipZone } from "../services/zoneOwnership.js";

interface ZoneRow {
    provider_id: string;
    zone_id: string;
    name: string;
    selected: number;
}

export interface StoredZone extends OwnershipZone {
    name: string;
}

const rowToZone = (row: ZoneRow): StoredZone => ({
    providerId: row.provider_id,
    zoneId: row.zone_id,
    name: row.name,
    selected: row.selected === 1,
});

export class ProviderZoneRepository {
    /** Every provider's zones, ordered by name. */
    static findAll(): StoredZone[] {
        return (db.prepare("SELECT * FROM provider_zones ORDER BY name").all() as ZoneRow[]).map(rowToZone);
    }

    /**
     * The zones a reading found, in place of the ones before. A zone that is still there
     * keeps whether it was ticked; a zone that is gone takes its tick with it.
     */
    static replace(providerId: string, zones: readonly ProviderZoneInfo[]): void {
        db.transaction(() => {
            const ticked = new Set(
                (db.prepare("SELECT zone_id FROM provider_zones WHERE provider_id = ? AND selected = 1").all(providerId) as {
                    zone_id: string;
                }[]).map((r) => r.zone_id),
            );
            db.prepare("DELETE FROM provider_zones WHERE provider_id = ?").run(providerId);
            const insert = db.prepare("INSERT INTO provider_zones (provider_id, zone_id, name, selected) VALUES (?, ?, ?, ?)");
            for (const zone of zones) insert.run(providerId, zone.id, zone.name, ticked.has(zone.id) ? 1 : 0);
        })();
    }

    /** Ticks exactly these zones of the provider. A zone it has not seen yet is not added. */
    static setSelected(providerId: string, zoneIds: readonly string[]): void {
        db.prepare(`
            UPDATE provider_zones SET selected = CASE WHEN zone_id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END
            WHERE provider_id = ?
        `).run(JSON.stringify(zoneIds), providerId);
    }
}
