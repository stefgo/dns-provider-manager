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

/** Who recorded an event. There is no agent: the server records everything. */
export const ACTIVITY_SOURCES = ["server"] as const;

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
    "scheduler.failed",
] as const;

/** The HTTP methods a webhook may send with. Both carry a body; GET does not. */
export const WEBHOOK_METHODS = ["POST", "PUT"] as const;

/**
 * The background jobs the server runs on a timer. Each keeps one row in `scheduler_state`:
 * its last finished run and whatever it has to remember from one run to the next.
 */
export const SCHEDULER_IDS = ["notification-cleanup"] as const;

/** Whether the timer started a run or a user did, through the settings page. */
export const SCHEDULER_TRIGGERS = ["schedule", "manual"] as const;

/**
 * How a finished run ended. `partial` finished but left work undone; `interrupted` never
 * finished, because the server stopped while it ran.
 */
export const SCHEDULER_RUN_STATUSES = ["success", "partial", "failed", "interrupted"] as const;
