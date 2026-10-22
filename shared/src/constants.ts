/**
 * The message types of the dashboard socket, `/ws/dashboard`. The server is the only one who
 * sends: the browser reads what it is told and makes its changes over REST.
 */
export const WS_EVENTS = {
    // Activity events
    /** The current activity list. */
    ACTIVITY_UPDATE: "ACTIVITY_UPDATE",
    /**
     * Events stored for the first time, to be merged into the list the dashboard already
     * holds.
     */
    ACTIVITY_APPENDED: "ACTIVITY_APPENDED",
    /** `{ ids }` the user of this session has just seen. Sent to that user only. */
    ACTIVITY_SEEN: "ACTIVITY_SEEN",

    // Provider events
    /**
     * `{ providerId }` was read again -- its zones, its state and what it holds. The dashboard
     * reads the providers and the unmanaged records anew; the payload says which provider,
     * not what changed.
     */
    READINGS_UPDATE: "READINGS_UPDATE",

    // Record events
    /**
     * `{ recordIds }` were written to a provider, or their state there changed -- written,
     * failed, drifted. The dashboard reads the records anew.
     */
    RECORDS_UPDATE: "RECORDS_UPDATE",

    // Scheduler events
    /** One scheduler's status, whenever a run starts or ends. */
    SCHEDULER_STATUS_UPDATE: "SCHEDULER_STATUS_UPDATE",
} as const;

/**
 * The port the server listens on unless config.yaml or the PORT environment variable names
 * another. It is the published one: the container exposes it and the compose files map it,
 * so an operator who moves the server has to move those with it.
 */
export const DEFAULT_SERVER_PORT = 3030;

/**
 * Who caused an event: `user` for a change someone made in the dashboard or through the API
 * (the user's name is in `data.user`), `server` for what the server observed or did by itself.
 */
export const ACTIVITY_SOURCES = ["server", "user"] as const;

/**
 * Ordered by severity, lowest first -- `ACTIVITY_LEVELS.indexOf` compares two levels.
 * `trace` is routine bookkeeping; the dashboard hides it unless asked to show it.
 */
export const ACTIVITY_LEVELS = ["trace", "info", "warning", "error"] as const;

/**
 * Every kind of event this build knows how to phrase. The database keeps whatever kind it
 * was given, and the dashboard falls back to a generic line for one it does not know -- an
 * event written by a later version stays readable after a downgrade.
 */
export const ACTIVITY_KINDS = [
    "record.created",
    "record.changed",
    "record.deleted",
    "record.adopted",
    "record.adoption",
    "record.written",
    "record.write_failed",
    "record.drift",
    "record.corrected",
    "record.accepted",
    "site.created",
    "site.changed",
    "site.deleted",
    "provider.created",
    "provider.changed",
    "provider.deleted",
    "provider.unreachable",
    "provider.recovered",
    "scheduler.failed",
] as const;

/** The HTTP methods a webhook may send with. Both carry a body; GET does not. */
export const WEBHOOK_METHODS = ["POST", "PUT"] as const;

/**
 * The background jobs the server runs on a timer. Each keeps one row in `scheduler_state`:
 * its last finished run and whatever it has to remember from one run to the next.
 */
export const SCHEDULER_IDS = ["notification-cleanup", "provider-read"] as const;

/** Whether the timer started a run or a user did, through the settings page. */
export const SCHEDULER_TRIGGERS = ["schedule", "manual"] as const;

/**
 * How a finished run ended. `partial` finished but left work undone; `interrupted` never
 * finished, because the server stopped while it ran.
 */
export const SCHEDULER_RUN_STATUSES = ["success", "partial", "failed", "interrupted"] as const;

// ── DNS ──────────────────────────────────────────────────────────────────────

/** The record types dpm manages. Every other type a provider holds is left alone. */
export const RECORD_TYPES = ["A", "AAAA", "CNAME"] as const;

/**
 * The kinds of DNS server dpm writes to. One provider is one access: a Cloudflare API token,
 * an AdGuard Home instance, a Samba AD domain.
 */
export const PROVIDER_TYPES = ["cloudflare", "adguard", "samba-ad"] as const;

/**
 * The types dpm writes to. A provider of another type is read and compared, never written:
 * writing to Samba AD comes with a later version.
 */
export const WRITABLE_PROVIDER_TYPES: readonly (typeof PROVIDER_TYPES)[number][] = ["cloudflare", "adguard"];

/**
 * Where a record stands at one of its providers:
 *
 * - `in_sync` -- the provider holds what dpm wrote.
 * - `pending` -- to be written: not yet tried, or held back (read only, zones not read yet).
 * - `error` -- the last attempt failed; it is tried again after the provider's next reading.
 * - `drift` -- the provider holds something else than dpm wrote: changed there, or switched off.
 * - `missing` -- what dpm wrote is gone from the provider.
 * - `removing` -- to be deleted at the provider: the record was deleted, or no longer goes there.
 */
export const LINK_STATUSES = ["in_sync", "pending", "error", "drift", "missing", "removing"] as const;

/**
 * What saving or deleting a record does at one provider: write it anew, change it, remove
 * it, take over an entry that is there already, nothing, held back (read only, zones not read
 * yet), or refused.
 */
export const SYNC_ACTIONS = ["create", "update", "delete", "adopt", "none", "blocked", "conflict"] as const;

/** How the providers are named on screen. */
export const PROVIDER_TYPE_LABELS: Record<(typeof PROVIDER_TYPES)[number], string> = {
    cloudflare: "Cloudflare",
    adguard: "AdGuard Home",
    "samba-ad": "Samba AD",
};

/**
 * Which zones a Cloudflare provider uses: every zone its token sees (new ones included), or
 * only those ticked. A zone is used by at most one provider either way.
 */
export const ZONE_MODES = ["all", "selected"] as const;

/** The TTL range dpm accepts, in seconds. No TTL means the provider's own default. */
export const TTL_MIN = 60;
export const TTL_MAX = 86400;
