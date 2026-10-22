import { z } from "zod";
import {
    ACTIVITY_LEVELS,
    PROVIDER_TYPES,
    RECORD_TYPES,
    SCHEDULER_RUN_STATUSES,
    SCHEDULER_TRIGGERS,
    WEBHOOK_METHODS,
    ZONE_MODES,
} from "./constants.js";
import { ActivityRecordSchema } from "./schemas.js";

/**
 * What the server sends a browser, one schema per shape: the answers of the REST endpoints
 * and the payloads of the dashboard socket (`dashboardMessages.ts`).
 *
 * The frontend parses every response against one of these (`lib/api.ts`), so a field
 * renamed on the server fails loudly at the request instead of arriving in a component as
 * `undefined`.
 *
 * They describe what is sent, not what is accepted: none of the input rules of `schemas.ts`
 * apply here. A row somebody edited by hand must not take a whole list down because its
 * name is longer than the form would allow. Nullability follows what the server sends,
 * which for a row read out of SQLite is `null` and not a missing key.
 */

// ── Activity ─────────────────────────────────────────────────────────────────

/** `GET /api/v1/activity`, `ACTIVITY_UPDATE` and `ACTIVITY_APPENDED`. */
export const ActivityListSchema = z.array(ActivityRecordSchema);

// ── Schedulers ───────────────────────────────────────────────────────────────

/**
 * One scheduler's status, with the result of its last run in the shape that scheduler
 * reports: how many rows the cleanup removed, how many providers the reading read and how
 * many it could not.
 *
 * The result is read out of `scheduler_state`, where a run of an earlier version may have
 * left another shape behind. That reads as "no result" instead of refusing the status of
 * every scheduler along with it.
 */
const schedulerStatus = <R extends z.ZodType>(result: R) =>
    z.object({
        isRunning: z.boolean(),
        /** Null when the scheduler is switched off. */
        nextRun: z.string().nullable(),
        lastRun: z
            .object({
                trigger: z.enum(SCHEDULER_TRIGGERS),
                status: z.enum(SCHEDULER_RUN_STATUSES),
                startedAt: z.string(),
                /** Null for a run the server did not live to finish (`interrupted`). */
                finishedAt: z.string().nullable(),
                /** Null unless the run succeeded, fully or in part. */
                result: result.nullable().catch(null),
                error: z.string().nullable(),
            })
            .nullable(),
    });

/** Every scheduler the server runs, by its id. `SCHEDULER_IDS` lists the same one. */
export const SchedulerStatusesSchema = z.object({
    "notification-cleanup": schedulerStatus(z.object({ removed: z.number() })),
    "provider-read": schedulerStatus(z.object({ read: z.number(), failed: z.number() })),
});

/** `GET /api/v1/settings/scheduler-status`. */
export const SchedulerStatusResponseSchema = z.object({ schedulers: SchedulerStatusesSchema });

const schedulerUpdate = <Id extends keyof typeof SchedulerStatusesSchema.shape>(id: Id) =>
    z.object({ scheduler: z.literal(id), status: SchedulerStatusesSchema.shape[id] });

/**
 * The payload of `SCHEDULER_STATUS_UPDATE`: one scheduler, whenever a run starts or ends.
 * The types in types.ts are written by hand, generic over the scheduler; this schema is
 * checked against them there.
 */
export const SchedulerStatusUpdateSchema = z.discriminatedUnion("scheduler", [
    schedulerUpdate("notification-cleanup"),
    schedulerUpdate("provider-read"),
]);

// ── Users, session ───────────────────────────────────────────────────────────

/** One row of `GET /api/v1/users`; the password hash is not among the columns. */
export const UserSchema = z.object({
    id: z.number(),
    username: z.string(),
    auth_methods: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
});

export const UserListSchema = z.array(UserSchema);

/** `GET /api/v1/me`: who the session belongs to, and until when. */
export const SessionUserSchema = z.object({
    id: z.number().nullish(),
    username: z.string().nullish(),
    expiresAt: z.string().nullish(),
});

/** `GET /api/auth/config`: which login the form offers. */
export const AuthConfigSchema = z.object({
    type: z.enum(["local", "oidc"]),
});

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/settings/cleanup`: the settings block of config.yaml, as it stands. Loose,
 * like the file -- a value an operator wrote by hand is a number there and a string once
 * the UI has saved it.
 */
export const SettingsResponseSchema = z.record(z.string(), z.unknown());

/**
 * What a job started by hand reports: `POST /api/v1/settings/cleanup/*` how many rows it
 * removed, `POST /api/v1/providers/read` how many providers it read and could not.
 */
export const ManualRunResultSchema = z.object({
    removed: z.number().optional(),
    read: z.number().optional(),
    failed: z.number().optional(),
});

// ── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * A webhook as the API returns it: what was configured, and how its last delivery went.
 * The shape of `WebhookSchema` without its input rules, see above.
 */
export const WebhookViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    url: z.string(),
    method: z.enum(WEBHOOK_METHODS),
    headers: z.record(z.string(), z.string()),
    bodyTemplate: z.string(),
    minLevel: z.enum(ACTIVITY_LEVELS),
    /** Kind patterns such as `record.*`; empty means every kind. */
    kinds: z.array(z.string()),
    timeoutMs: z.number(),
    /** The HTTP status of the last attempt; null when it never got an answer. */
    lastStatus: z.number().nullable(),
    lastError: z.string().nullable(),
    lastAttemptAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
});

/** `GET /api/v1/webhooks`. */
export const WebhookListSchema = z.array(WebhookViewSchema);

/** `POST /api/v1/webhooks/test`: what was sent, and what came back. */
export const WebhookTestResultSchema = z.object({
    ok: z.boolean(),
    status: z.number().nullable(),
    error: z.string().nullable(),
    /** The rendered body, as it went out. */
    body: z.unknown(),
    /** The start of the target's answer, for seeing why it refused. */
    response: z.string().nullable(),
});

// ── DNS ──────────────────────────────────────────────────────────────────────

/** A record as the API returns it, with the sites it belongs to. */
export const RecordViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(RECORD_TYPES),
    value: z.string(),
    ttl: z.number().nullable(),
    proxied: z.boolean(),
    note: z.string(),
    siteIds: z.array(z.string()),
    createdAt: z.string(),
    /** The user who made the change; null for a row nobody made in the dashboard. */
    createdBy: z.string().nullable(),
    updatedAt: z.string().nullable(),
    updatedBy: z.string().nullable(),
});

/** `GET /api/v1/records`, ordered by name. */
export const RecordListSchema = z.array(RecordViewSchema);

/** A site as the API returns it: its providers, and how many records belong to it. */
export const SiteViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    providerIds: z.array(z.string()),
    recordCount: z.number(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
});

/** `GET /api/v1/sites`, ordered by name. */
export const SiteListSchema = z.array(SiteViewSchema);

/**
 * A zone a provider's token sees. `owner` is the provider that uses it -- this one, another
 * one that sees the same zone, or null when nobody does (not ticked under "Selected zones").
 */
export const ProviderZoneViewSchema = z.object({
    id: z.string(),
    name: z.string(),
    selected: z.boolean(),
    owner: z.string().nullable(),
});

const providerView = {
    id: z.string(),
    name: z.string(),
    autoCorrect: z.boolean(),
    /** Whether a secret is stored. The secret itself never leaves the server. */
    hasSecret: z.boolean(),
    /** The sites the provider belongs to. */
    siteIds: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
    /** When the server last reached the provider, and why it last failed to. */
    lastSeenAt: z.string().nullable(),
    lastError: z.string().nullable(),
    /** The zones of the last reading; empty for a provider that has none, or was never read. */
    zones: z.array(ProviderZoneViewSchema),
    /** Whether this build can read the provider yet. */
    readable: z.boolean(),
};

/** A provider as the API returns it, one shape per type, without its secret. */
export const ProviderViewSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("cloudflare"),
        ...providerView,
        zoneMode: z.enum(ZONE_MODES),
        zoneIds: z.array(z.string()),
    }),
    z.object({
        type: z.literal("adguard"),
        ...providerView,
        url: z.string(),
        username: z.string(),
        allowSelfSigned: z.boolean(),
    }),
    z.object({
        type: z.literal("samba-ad"),
        ...providerView,
        servers: z.array(z.string()),
        username: z.string(),
        allowSelfSigned: z.boolean(),
    }),
]);

/** `GET /api/v1/providers`, ordered by name. */
export const ProviderListSchema = z.array(ProviderViewSchema);

/** `POST /api/v1/providers/test`: whether the provider answers, and what it said. */
export const ProviderTestResultSchema = z.object({
    ok: z.boolean(),
    message: z.string(),
    zones: z.array(z.object({ id: z.string(), name: z.string() })),
});

/** One provider's last reading, as the unmanaged page shows it. */
export const ReadingViewSchema = z.object({
    providerId: z.string(),
    providerType: z.enum(PROVIDER_TYPES),
    /** Null while the provider was never read since the server started. */
    readAt: z.string().nullable(),
    error: z.string().nullable(),
    /** How many A, AAAA and CNAME records it holds in the zones it uses. */
    recordCount: z.number(),
});

/**
 * An entry a provider holds that dpm does not manage there. `recordId` names a record of dpm
 * with the same name, type and value that is not meant for this provider yet: adopting the
 * entry gives that record the site instead of creating another. `problem` says why the entry
 * cannot be taken over at all, such as a name dpm does not accept.
 */
export const UnmanagedEntrySchema = z.object({
    providerId: z.string(),
    externalId: z.string(),
    zone: z.string().nullable(),
    name: z.string(),
    type: z.enum(RECORD_TYPES),
    value: z.string(),
    ttl: z.number().nullable(),
    proxied: z.boolean(),
    recordId: z.string().nullable(),
    problem: z.string().nullable(),
});

/** `GET /api/v1/unmanaged`. */
export const UnmanagedResponseSchema = z.object({
    readings: z.array(ReadingViewSchema),
    entries: z.array(UnmanagedEntrySchema),
});

/** `POST /api/v1/unmanaged/adopt`: what was taken over, and what was refused and why. */
export const AdoptResultSchema = z.object({
    adopted: z.array(
        z.object({ name: z.string(), type: z.enum(RECORD_TYPES), value: z.string(), merged: z.boolean() }),
    ),
    refused: z.array(
        z.object({ name: z.string(), type: z.string(), value: z.string(), reason: z.string() }),
    ),
});
