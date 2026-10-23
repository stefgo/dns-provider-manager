import type { MigrationContext } from "./context.js";

/**
 * TTL and Cloudflare's proxy move from the record to each provider it goes to: a record may be
 * proxied at one Cloudflare account and not at another, and have a TTL of its own at each.
 *
 * - A record without a row for a provider gets the provider's defaults there: its own TTL, no
 *   proxy. A row that says only the defaults is not stored.
 * - Record and provider each take their rows with them (CASCADE). A provider that leaves a
 *   record's sites keeps its row, so the setting is there again when it comes back.
 * - What a record had is carried over to every provider it has a link with, as far as the
 *   provider knows the field: a TTL to Cloudflare and Samba AD, the proxy to Cloudflare.
 */
export const migration04 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE record_settings (
            record_id   TEXT    NOT NULL REFERENCES records(id)   ON DELETE CASCADE,
            provider_id TEXT    NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            ttl         INTEGER,
            proxied     INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (record_id, provider_id)
          ) WITHOUT ROWID;

          CREATE INDEX record_settings_provider ON record_settings (provider_id);

          INSERT INTO record_settings (record_id, provider_id, ttl, proxied)
            SELECT r.id, p.id,
                   CASE WHEN p.type IN ('cloudflare', 'samba-ad') THEN r.ttl END,
                   CASE WHEN p.type = 'cloudflare' THEN r.proxied ELSE 0 END
            FROM records r
            JOIN record_links l ON l.record_id = r.id
            JOIN providers p ON p.id = l.provider_id
            WHERE (p.type IN ('cloudflare', 'samba-ad') AND r.ttl IS NOT NULL)
               OR (p.type = 'cloudflare' AND r.proxied = 1);

          ALTER TABLE records DROP COLUMN ttl;
          ALTER TABLE records DROP COLUMN proxied;
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          ALTER TABLE records ADD COLUMN ttl INTEGER;
          ALTER TABLE records ADD COLUMN proxied INTEGER NOT NULL DEFAULT 0;

          UPDATE records SET
            ttl     = (SELECT max(ttl) FROM record_settings WHERE record_id = records.id),
            proxied = coalesce((SELECT max(proxied) FROM record_settings WHERE record_id = records.id), 0);

          DROP TABLE IF EXISTS record_settings;
        `);
    },
};
