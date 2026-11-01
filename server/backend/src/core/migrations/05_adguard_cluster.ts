import type { MigrationContext } from "./context.js";

/**
 * AdGuard Home clusters: a provider of type `adguard-cluster` is several AdGuard Home
 * instances (nodes). One is the primary, read and written like a single instance; the others
 * are made copies of it, area by area.
 *
 * - `provider_clusters` holds what a cluster keeps alike (`areas`, a JSON array of
 *   `CONFIG_AREAS`), why its primary could not be read on the last run (`paused_error`, NULL
 *   while it could: the activity reports the change, not every run) and when it last ran.
 * - `cluster_nodes` are the instances, each with its own password, encrypted like a
 *   provider's secret. Exactly one node of a cluster is the primary. `version`, `last_seen_at`
 *   and `last_error` are what the last run found there.
 * - `cluster_baselines` hold, per cluster and area, what the last run found at the primary and
 *   spread, in comparable form (`state`, JSON) and as its hash.
 * - `cluster_links` say where each area stands at each node besides the primary: the hash of
 *   what dpm last wrote there (`written_hash`, NULL before the first write) -- what tells a node
 *   that is only behind from one changed by hand -- and how the last attempt went.
 *
 * A cluster that goes takes its nodes, baselines and links with it, a node its links; nothing
 * is changed at the instances.
 */
export const migration05 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE provider_clusters (
            provider_id  TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
            areas        TEXT NOT NULL DEFAULT '[]',
            paused_error TEXT,
            last_run_at  TEXT
          );

          CREATE TABLE cluster_nodes (
            id                TEXT    PRIMARY KEY,
            provider_id       TEXT    NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            name              TEXT    NOT NULL,
            url               TEXT    NOT NULL,
            username          TEXT    NOT NULL,
            allow_self_signed INTEGER NOT NULL DEFAULT 0,
            secret            TEXT,
            is_primary        INTEGER NOT NULL DEFAULT 0,
            position          INTEGER NOT NULL DEFAULT 0,
            version           TEXT,
            last_seen_at      TEXT,
            last_error        TEXT,
            created_at        TEXT    NOT NULL,
            updated_at        TEXT
          );

          CREATE INDEX cluster_nodes_provider ON cluster_nodes (provider_id);
          CREATE UNIQUE INDEX cluster_nodes_primary ON cluster_nodes (provider_id) WHERE is_primary = 1;

          CREATE TABLE cluster_baselines (
            provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            area        TEXT NOT NULL,
            state       TEXT NOT NULL,
            hash        TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            PRIMARY KEY (provider_id, area)
          ) WITHOUT ROWID;

          CREATE TABLE cluster_links (
            node_id         TEXT    NOT NULL REFERENCES cluster_nodes(id) ON DELETE CASCADE,
            area            TEXT    NOT NULL,
            written_hash    TEXT,
            status          TEXT    NOT NULL,
            error           TEXT,
            attempts        INTEGER NOT NULL DEFAULT 0,
            last_attempt_at TEXT,
            synced_at       TEXT,
            PRIMARY KEY (node_id, area)
          ) WITHOUT ROWID;
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS cluster_links;
          DROP TABLE IF EXISTS cluster_baselines;
          DROP TABLE IF EXISTS cluster_nodes;
          DROP TABLE IF EXISTS provider_clusters;
        `);
    },
};
