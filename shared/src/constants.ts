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

    // Cluster events
    /**
     * `{ providerId }`: a run kept the nodes of an AdGuard Home cluster alike, or how it stands
     * changed. The dashboard reads the clusters' status anew.
     */
    CLUSTER_UPDATE: "CLUSTER_UPDATE",

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
    "record.sites_change",
    "record.written",
    "record.write_failed",
    "record.drift",
    "record.corrected",
    "record.accepted",
    "record.released",
    "site.created",
    "site.changed",
    "site.deleted",
    "provider.created",
    "provider.changed",
    "provider.deleted",
    "provider.unreachable",
    "provider.recovered",
    "cluster.propagated",
    "cluster.corrected",
    "cluster.write_failed",
    "cluster.paused",
    "cluster.resumed",
    "cluster.primary_changed",
    "scheduler.failed",
] as const;

/** The HTTP methods a webhook may send with. Both carry a body; GET does not. */
export const WEBHOOK_METHODS = ["POST", "PUT"] as const;

/**
 * The background jobs the server runs on a timer. Each keeps one row in `scheduler_state`:
 * its last finished run and whatever it has to remember from one run to the next.
 */
export const SCHEDULER_IDS = ["notification-cleanup", "provider-read", "cluster-sync"] as const;

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
 * an AdGuard Home instance, a Samba AD domain -- or an AdGuard Home cluster, several instances
 * dpm keeps alike and treats as one.
 */
export const PROVIDER_TYPES = ["cloudflare", "adguard", "adguard-cluster", "samba-ad"] as const;

/**
 * The types dpm writes to. A provider of another type is read and compared, never written:
 * writing to Samba AD comes with a later version.
 */
export const WRITABLE_PROVIDER_TYPES: readonly (typeof PROVIDER_TYPES)[number][] = ["cloudflare", "adguard", "adguard-cluster"];

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
    "adguard-cluster": "AdGuard Home cluster",
    "samba-ad": "Samba AD",
};

/**
 * Which zones a Cloudflare provider uses: every zone its token sees (new ones included), or
 * only those ticked. A zone is used by at most one provider either way.
 */
export const ZONE_MODES = ["all", "selected"] as const;

/**
 * What a type of provider knows besides name, type and value. A field it does not know is
 * neither written nor compared, and the editor offers no setting for it: AdGuard Home has no
 * TTL, and only Cloudflare proxies.
 */
export interface ProviderCapabilities {
    /** Records live in zones, and a record goes to the provider whose zone holds its name. */
    zoned: boolean;
    ttl: boolean;
    proxied: boolean;
}

export const PROVIDER_CAPABILITIES: Record<(typeof PROVIDER_TYPES)[number], ProviderCapabilities> = {
    cloudflare: { zoned: true, ttl: true, proxied: true },
    adguard: { zoned: false, ttl: false, proxied: false },
    "adguard-cluster": { zoned: false, ttl: false, proxied: false },
    "samba-ad": { zoned: true, ttl: true, proxied: false },
};

// ── AdGuard Home clusters ────────────────────────────────────────────────────

/**
 * The parts of AdGuard Home's configuration a cluster keeps alike on its nodes, copied from
 * its primary, in the order a run goes through them: the blocklists before the allowlists, so
 * that a list moved to the allowlists at the primary leaves a node's blocklists first.
 */
export const CONFIG_AREAS = ["rewrites", "general", "dns", "clients", "blocklists", "allowlists", "blocked_services", "user_rules"] as const;

/** The areas every cluster keeps alike: without its rewrites a node would not hold the records. */
export const FIXED_CONFIG_AREAS: readonly (typeof CONFIG_AREAS)[number][] = ["rewrites"];

/** The areas a new cluster starts with. DNS settings are left to be chosen. */
export const DEFAULT_CONFIG_AREAS: readonly (typeof CONFIG_AREAS)[number][] = CONFIG_AREAS.filter((area) => area !== "dns");

/** How the areas are named on screen, in AdGuard Home's own words. */
export const CONFIG_AREA_LABELS: Record<(typeof CONFIG_AREAS)[number], string> = {
    rewrites: "DNS rewrites",
    general: "General settings",
    dns: "DNS settings",
    clients: "Client settings",
    blocklists: "DNS blocklists",
    allowlists: "DNS allowlists",
    blocked_services: "Blocked services",
    user_rules: "Custom filtering rules",
};

/**
 * Where one area stands at one node besides the primary: the same as the primary, still to be
 * written (not reached yet, or new), the last write failed, or not compared at all because the
 * primary could not be read.
 */
export const CONFIG_LINK_STATUSES = ["in_sync", "pending", "error", "paused"] as const;

/** The TTL range dpm accepts, in seconds. No TTL means the provider's own default. */
export const TTL_MIN = 60;
export const TTL_MAX = 86400;
