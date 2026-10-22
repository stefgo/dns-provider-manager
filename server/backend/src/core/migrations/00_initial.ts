import type { MigrationContext } from "./context.js";

/**
 * The schema dpm starts from: users, the activity log with its seen state, the schedulers
 * and the webhooks, where keepalived-status-monitor's migrations had brought them -- without
 * its agents and keepalived tables, and as one step rather than a history nobody here ran.
 */
export const migration00 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            auth_methods TEXT DEFAULT 'local',
            token_version INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS activity (
            id             TEXT PRIMARY KEY,
            source         TEXT NOT NULL,
            kind           TEXT NOT NULL,
            level          TEXT NOT NULL,
            correlation_id TEXT,
            subject        TEXT,
            data           TEXT,
            occurred_at    TEXT NOT NULL,
            received_at    TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS activity_corr     ON activity (correlation_id);
          CREATE INDEX IF NOT EXISTS activity_occurred ON activity (occurred_at DESC);

          CREATE TABLE IF NOT EXISTS activity_seen (
            activity_id TEXT    NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
            PRIMARY KEY (activity_id, user_id)
          ) WITHOUT ROWID;

          CREATE TABLE IF NOT EXISTS scheduler_state (
            scheduler        TEXT PRIMARY KEY,
            running_since    TEXT,
            running_trigger  TEXT,
            last_started_at  TEXT,
            last_finished_at TEXT,
            last_trigger     TEXT,
            last_status      TEXT,
            last_result      TEXT,
            last_error       TEXT,
            state            TEXT,
            next_run_at      TEXT
          );

          CREATE TABLE IF NOT EXISTS webhooks (
            id              TEXT    PRIMARY KEY,
            name            TEXT    NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1,
            url             TEXT    NOT NULL,
            method          TEXT    NOT NULL DEFAULT 'POST',
            headers         TEXT    NOT NULL DEFAULT '{}',
            body_template   TEXT    NOT NULL,
            min_level       TEXT    NOT NULL DEFAULT 'warning',
            kinds           TEXT    NOT NULL DEFAULT '[]',
            timeout_ms      INTEGER NOT NULL DEFAULT 10000,
            last_status     INTEGER,
            last_error      TEXT,
            last_attempt_at TEXT,
            created_at      TEXT    NOT NULL,
            updated_at      TEXT
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS webhooks;
          DROP TABLE IF EXISTS scheduler_state;
          DROP TABLE IF EXISTS activity_seen;
          DROP TABLE IF EXISTS activity;
          DROP TABLE IF EXISTS users;
        `);
    },
};
