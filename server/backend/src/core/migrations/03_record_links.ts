import type { MigrationContext } from "./context.js";

/**
 * Where each record stands at each provider it goes to: what the provider calls it, what dpm
 * last wrote there, and how the last attempt and the last reading went.
 *
 * - `record_id` has no REFERENCES clause on purpose: a deleted record keeps its links until
 *   the providers have removed it as well. A link whose record is gone is a removal still
 *   under way; it is deleted once the provider no longer holds the record.
 * - A provider that goes takes its links with it (CASCADE): dpm stops managing what it wrote
 *   there and deletes nothing.
 * - `external_id` is NULL until the record was written or found there; `zone_id` is NULL at
 *   a provider without zones.
 * - `written` and `observed` are JSON: what dpm wrote (name, type, value, TTL, proxied), and
 *   what the provider holds instead while the link is in `drift`.
 *
 * `providers.read_only` keeps dpm from writing to a provider at all; it is read and compared
 * all the same.
 */
export const migration03 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          ALTER TABLE providers ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;

          CREATE TABLE record_links (
            record_id       TEXT    NOT NULL,
            provider_id     TEXT    NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            zone_id         TEXT,
            external_id     TEXT,
            written         TEXT,
            status          TEXT    NOT NULL,
            error           TEXT,
            observed        TEXT,
            attempts        INTEGER NOT NULL DEFAULT 0,
            last_attempt_at TEXT,
            synced_at       TEXT,
            PRIMARY KEY (record_id, provider_id)
          ) WITHOUT ROWID;

          CREATE INDEX record_links_provider ON record_links (provider_id);
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS record_links;
          ALTER TABLE providers DROP COLUMN read_only;
        `);
    },
};
