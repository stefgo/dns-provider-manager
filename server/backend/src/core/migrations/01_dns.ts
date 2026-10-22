import type { MigrationContext } from "./context.js";

/**
 * What dpm is for: the records, the sites they belong to and the providers a site writes to.
 *
 * - `providers` keeps what is particular to its type as JSON (`settings`) and its one secret
 *   -- an API token or a password -- encrypted with `secretKey` (`secret`). The type of a row
 *   never changes.
 * - A record is one name, type and value; the same three twice would be one record, so they
 *   are unique together. `ttl` NULL is the provider's own default.
 * - A record belongs to at least one site. `record_sites` refuses to lose a site under its
 *   records (RESTRICT): the service says which records would be left without one.
 *
 * Names of sites and providers are unique without regard to case, as the dashboard compares
 * them.
 */
export const migration01 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE providers (
            id           TEXT    PRIMARY KEY,
            type         TEXT    NOT NULL,
            name         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
            settings     TEXT    NOT NULL DEFAULT '{}',
            secret       TEXT,
            auto_correct INTEGER NOT NULL DEFAULT 0,
            last_seen_at TEXT,
            last_error   TEXT,
            created_at   TEXT    NOT NULL,
            updated_at   TEXT
          );

          CREATE TABLE sites (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
            description TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT
          );

          CREATE TABLE site_providers (
            site_id     TEXT NOT NULL REFERENCES sites(id)     ON DELETE CASCADE,
            provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            PRIMARY KEY (site_id, provider_id)
          ) WITHOUT ROWID;

          CREATE TABLE records (
            id         TEXT    PRIMARY KEY,
            name       TEXT    NOT NULL,
            type       TEXT    NOT NULL,
            value      TEXT    NOT NULL,
            ttl        INTEGER,
            proxied    INTEGER NOT NULL DEFAULT 0,
            note       TEXT    NOT NULL DEFAULT '',
            created_at TEXT    NOT NULL,
            created_by TEXT,
            updated_at TEXT,
            updated_by TEXT,
            UNIQUE (name, type, value)
          );

          CREATE TABLE record_sites (
            record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
            site_id   TEXT NOT NULL REFERENCES sites(id)   ON DELETE RESTRICT,
            PRIMARY KEY (record_id, site_id)
          ) WITHOUT ROWID;

          CREATE INDEX record_sites_site ON record_sites (site_id);
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS record_sites;
          DROP TABLE IF EXISTS records;
          DROP TABLE IF EXISTS site_providers;
          DROP TABLE IF EXISTS sites;
          DROP TABLE IF EXISTS providers;
        `);
    },
};
