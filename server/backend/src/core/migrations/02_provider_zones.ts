import type { MigrationContext } from "./context.js";

/**
 * The zones a provider's token sees, as its last reading found them, and which of them are
 * ticked under "Selected zones". Which provider uses a zone is not stored: it follows from
 * these rows and the providers' modes every time it is asked (`zoneOwnership`), so it cannot
 * go out of step with them.
 *
 * `zone_id` is the provider's own id of the zone -- for Cloudflare its zone id, the same for
 * every token that sees the zone, which is how two providers seeing one zone are told.
 */
export const migration02 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE provider_zones (
            provider_id TEXT    NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            zone_id     TEXT    NOT NULL,
            name        TEXT    NOT NULL,
            selected    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (provider_id, zone_id)
          ) WITHOUT ROWID;

          CREATE INDEX provider_zones_zone ON provider_zones (zone_id);
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE IF EXISTS provider_zones;`);
    },
};
