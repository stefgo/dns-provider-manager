import { z } from "zod";
import {
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    WEBHOOK_METHODS,
} from "./constants.js";
import { placeholderError, webhookTemplateError } from "./webhookTemplate.js";
import { parseLevelOverrides } from "./activityLevelOverrides.js";

/**
 * One entry of `security.trusted_proxies`: what Fastify's `trustProxy` (proxy-addr) accepts
 * as a list item. The three names are proxy-addr's presets: `loopback` (127.0.0.1/8, ::1),
 * `linklocal` and `uniquelocal` (the RFC 1918 ranges and fc00::/7, which covers a proxy on
 * a Docker bridge network whose address is not fixed).
 */
export const TrustedProxySchema = z.union(
    [
        z.ipv4(),
        z.cidrv4(),
        z.ipv6(),
        z.cidrv6(),
        z.enum(["loopback", "linklocal", "uniquelocal"]),
    ],
    {
        error: "Must be an IP address, a network in CIDR notation, or one of loopback, linklocal, uniquelocal",
    },
);

/** YAML turns an empty block (`settings:` with nothing below it) into null. */
const blockOrMissing = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => value ?? undefined, schema);

/** The levels pino accepts, for both config files. */
export const LogLevelSchema = z.enum([
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
    "silent",
]);

// REST request bodies
//
// What the HTTP endpoints accept. They exist for the same reason the WebSocket schemas do: an
// unchecked body reaches a repository or the config file unaltered.
// They live here rather than in the backend so the frontend can derive its types from them.

/** `POST /api/login`. An empty field is a malformed request, not a failed login. */
export const LoginPayloadSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

/**
 * A comma-separated list of `local` and `oidc`. The empty string is accepted because the
 * user dialog sends it when no box is ticked, and the controllers read it as "not given".
 */
const AuthMethodsSchema = z
    .string()
    .regex(
        /^((local|oidc)(,(local|oidc))*)?$/,
        'Must be a comma-separated list of "local" and "oidc"',
    );

/**
 * `POST /api/v1/users`. `password` is optional here because an OIDC-only user has none; that
 * a local user needs one is a rule about the combination, checked by the controller.
 */
export const CreateUserSchema = z.object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).optional(),
    auth_methods: AuthMethodsSchema.optional(),
});

/** `PUT /api/v1/users/:userId`. Either field alone is a valid edit. */
export const UpdateUserSchema = z.object({
    password: z.string().min(1).optional(),
    auth_methods: AuthMethodsSchema.optional(),
});

/**
 * A count, a number of days or an interval. YAML reads `30` without quotes as a number, and
 * the settings page sends back what it read, so both spellings are accepted and stored as
 * the string the rest of the backend expects.
 */
const WholeNumberSettingSchema = z
    .union([
        z.string().regex(/^\d+$/, "Must be a whole number"),
        z.number().int().nonnegative(),
    ])
    .transform(String);

/**
 * Which level an event kind is recorded with, or `none` for not at all -- see
 * `parseLevelOverrides` for the format. Refused with the reason of the first entry that
 * cannot be read, so a typo is not an override that silently never applies.
 */
const ActivityLevelOverridesSettingSchema = z.string().superRefine((text, ctx) => {
    const { error } = parseLevelOverrides(text);
    if (error) ctx.addIssue({ code: "custom", message: error });
});

/**
 * `PUT /api/v1/settings/cleanup`.
 *
 * Loose on purpose: the settings page reads the whole block and sends it back, so a key an
 * operator added to config.yaml by hand travels through here on every save. A strict schema
 * would strip it and the save would delete it from the file.
 *
 * `security` is refused. It decides which proxies are trusted and whether HSTS is sent, the
 * page never edits it, and it belongs to config.yaml alone -- a stolen session must not be
 * able to change it.
 */
export const CleanupSettingsSchema = z.looseObject({
    notification_retention_days: WholeNumberSettingSchema.optional(),
    notification_retention_count: WholeNumberSettingSchema.optional(),
    notification_cleanup_interval_hours: WholeNumberSettingSchema.optional(),
    activity_level_overrides: ActivityLevelOverridesSettingSchema.optional(),
    security: z
        .undefined({
            error: "Configured in config.yaml only, not through this endpoint",
        })
        .optional(),
});

// Server configuration (config.yaml)

/**
 * The `settings` block, with every default the server falls back to. Loose for the same
 * reason CleanupSettingsSchema is: the settings page writes the block back whole, so a key
 * added by hand has to survive. Values are stored as strings, whatever spelling YAML used.
 */
export const AppSettingsSchema = z
    .looseObject({
        notification_retention_days: WholeNumberSettingSchema.default("90"),
        notification_retention_count: WholeNumberSettingSchema.default("500"),
        notification_cleanup_interval_hours: WholeNumberSettingSchema.default("24"),
        activity_level_overrides: ActivityLevelOverridesSettingSchema.default(""),
    })
    .prefault({});

/**
 * OIDC. The example config ships the block with empty fields and `enabled: false`, so the
 * fields are only required -- and checked -- once the block is switched on.
 */
export const OidcConfigSchema = z
    .looseObject({
        enabled: z.boolean().default(false),
        issuer: z.string().nullish(),
        client_id: z.string().nullish(),
        client_secret: z.string().nullish(),
        redirect_uri: z.string().nullish(),
    })
    .superRefine((oidc, ctx) => {
        if (!oidc.enabled) return;
        for (const key of ["issuer", "redirect_uri"] as const) {
            if (!z.url().safeParse(oidc[key]).success) {
                ctx.addIssue({
                    code: "custom",
                    path: [key],
                    message: "Required as a URL while oidc.enabled is true",
                });
            }
        }
        for (const key of ["client_id", "client_secret"] as const) {
            if (!oidc[key]) {
                ctx.addIssue({
                    code: "custom",
                    path: [key],
                    message: "Required while oidc.enabled is true",
                });
            }
        }
    });

export const SecurityConfigSchema = z
    .object({
        /**
         * The reverse proxies whose X-Forwarded-For/-Proto/-Host this server believes.
         *
         * Empty by default, which means no one's: the client address is the socket's peer
         * and the scheme is the connection's own. Trusting every peer, as this server used
         * to, let anyone who reaches the port directly choose the address that the login
         * rate limit is taken from. Behind a proxy, its address has to be listed here -- otherwise every
         * request appears to come from the proxy.
         */
        trusted_proxies: z.array(TrustedProxySchema).default([]),
        /** Send Strict-Transport-Security. Off unless set -- see config.example.yaml. */
        hsts: z.boolean().default(false),
    })
    .prefault({});

/**
 * The whole of config.yaml.
 *
 * Loose at the top level: saveConfig() writes the parsed object back into the YAML
 * document, so a strict schema would not only ignore a key an operator added -- the next
 * save would delete it from the file.
 *
 * `jwtSecret` and `secretKey` are required although a fresh installation has neither: the
 * server generates and saves both before this schema is applied, so a missing value at that
 * point is an error, not a server that signs tokens with `undefined`.
 */
export const AppConfigSchema = z.looseObject({
    jwtSecret: z.string().min(1),
    /**
     * Encrypts the secrets the server stores and has to read back -- the credentials of the
     * DNS providers. Separate from `jwtSecret`, so that rotating the session key does not
     * make them unreadable.
     */
    secretKey: z.string().min(1),
    /** Any span @fastify/jwt accepts. There is no way to switch expiry off. */
    jwtExpiresIn: z.string().min(1).default("12h"),
    logLevel: LogLevelSchema.optional(),
    /**
     * Optional like `logLevel`, and for the same reason: left out it stays DEFAULT_SERVER_PORT,
     * and nothing writes the number into a file the operator never put it in.
     */
    port: z.number().int().min(1).max(65535).optional(),
    oidc: blockOrMissing(OidcConfigSchema.optional()),
    settings: blockOrMissing(AppSettingsSchema),
    security: blockOrMissing(SecurityConfigSchema),
});

export type AppConfigParsed = z.output<typeof AppConfigSchema>;

// ── Activity ─────────────────────────────────────────────────────────────────

/**
 * What an event is about. Loose on purpose: an event written by another version may know
 * more about its subject than this build asks for, and it is kept as it was stored.
 */
export const ActivitySubjectSchema = z.looseObject({});

/**
 * One thing that happened. It is stored under its id, so writing it twice changes nothing.
 *
 * None of the three vocabulary fields -- `kind`, `level`, `source` -- may refuse a word it
 * does not know: a row written by another version may carry one, and the list must not fail
 * over it. `kind` is therefore a plain string rather than an enum over `ACTIVITY_KINDS`; the
 * dashboard phrases what it recognises and falls back to a generic line for the rest. `level`
 * and `source` stay enums but normalise an unknown value instead of rejecting it -- the
 * readers of those two compare against the known set (`ACTIVITY_LEVELS.indexOf` in the
 * frontend), so a foreign word passed through would read as "below everything".
 */
export const ActivityEventSchema = z.object({
    id: z.string().min(1),
    /** When it happened. The server records when it stored it separately. */
    occurredAt: z.string().min(1),
    source: z.enum(ACTIVITY_SOURCES).catch("server"),
    kind: z.string().min(1),
    // A level this build does not know becomes `info`: visible, and comparable against the
    // levels that do exist. The table has no CHECK constraint, so this enum is the only
    // guard there is.
    level: z.enum(ACTIVITY_LEVELS).catch("info"),
    /** Groups events that belong together, entered by whoever caused them. */
    correlationId: z.string().nullish(),
    subject: ActivitySubjectSchema.nullish(),
    data: z.record(z.string(), z.unknown()).nullish(),
});

/** `POST /api/v1/activity/seen`. The events the calling user has seen. */
export const MarkActivitySeenSchema = z.object({
    ids: z.array(z.string().min(1)).min(1),
});

/**
 * An event as the server holds it. The list is ordered by `occurredAt`, because that is when
 * it happened; "new to me" rests on `seen`.
 */
export const ActivityRecordSchema = ActivityEventSchema.extend({
    receivedAt: z.string().min(1),
    /**
     * Whether the user the list was read for has seen the event. Each user gets their own
     * answer; who else has seen it is not part of the record.
     */
    seen: z.boolean(),
});

// ── Webhooks ─────────────────────────────────────────────────────────────────

/** RFC 9110 token characters: what a header name may consist of. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * `POST /api/v1/webhooks`, `PUT /api/v1/webhooks/:id` and the body of a preview. The body
 * template stays a string: it is stored as the operator wrote it, indentation included, and
 * only checked here -- see webhookTemplate.ts for what it may contain.
 */
export const WebhookInputSchema = z.object({
    name: z.string().trim().min(1, "A name is required").max(100),
    enabled: z.boolean().default(true),
    url: z
        .string()
        .trim()
        .regex(/^https?:\/\/\S+$/i, "Must be an http:// or https:// URL")
        .refine((url) => placeholderError(url) === null, {
            error: (issue) => placeholderError(issue.input) ?? "Invalid placeholder",
        }),
    method: z.enum(WEBHOOK_METHODS).default("POST"),
    headers: z
        .record(z.string().regex(HEADER_NAME, "Not a valid header name"), z.string())
        .default({})
        .refine((headers) => placeholderError(Object.values(headers)) === null, {
            error: (issue) => placeholderError(Object.values(issue.input as object)) ?? "Invalid placeholder",
        }),
    bodyTemplate: z
        .string()
        .min(1, "A body template is required")
        .max(65536, "A body template may be at most 64 KiB")
        .refine((source) => webhookTemplateError(source) === null, {
            error: (issue) => webhookTemplateError(issue.input as string) ?? "Invalid template",
        }),
    minLevel: z.enum(ACTIVITY_LEVELS).default("warning"),
    /** Kind patterns such as `record.*`; empty means every kind. */
    kinds: z.array(z.string().trim().min(1)).default([]),
    timeoutMs: z.number().int().min(1000).max(60000).default(10000),
});

/** A webhook as the API returns it: what was configured, and how its last delivery went. */
export const WebhookSchema = WebhookInputSchema.extend({
    id: z.string(),
    /** The HTTP status of the last attempt; null when it never got an answer. */
    lastStatus: z.number().nullable(),
    lastError: z.string().nullable(),
    lastAttemptAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
});
