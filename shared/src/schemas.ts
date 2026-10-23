import { z } from "zod";
import {
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    RECORD_TYPES,
    TTL_MAX,
    TTL_MIN,
    WEBHOOK_METHODS,
    ZONE_MODES,
} from "./constants.js";
import { dnsNameError, normaliseDnsName } from "./dnsName.js";
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
    provider_read_interval_minutes: WholeNumberSettingSchema.optional(),
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
        /** Minutes between two readings of every provider; 0 reads only on request. */
        provider_read_interval_minutes: WholeNumberSettingSchema.default("5"),
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

// ── DNS ──────────────────────────────────────────────────────────────────────

type RecordType = (typeof RECORD_TYPES)[number];

/** A list without repeats, in the order given -- a site picked twice is picked once. */
const unique = (ids: string[]) => [...new Set(ids)];

/** A name of something dpm manages: a site, a provider. Unique, ignoring case. */
const EntityNameSchema = z.string().trim().min(1, { error: "Enter a name" }).max(64);

/**
 * A DNS name as the user typed it, stored normalised (`normaliseDnsName`). `wildcard` allows
 * a leading `*` label.
 */
const dnsName = (wildcard: boolean) =>
    z
        .string()
        .transform(normaliseDnsName)
        .superRefine((name, ctx) => {
            const error = dnsNameError(name, { wildcard });
            if (error) ctx.addIssue({ code: "custom", message: error });
        });

/** Why `value` cannot be what a record of `type` answers with, or null. Both trimmed. */
export function recordValueError(type: RecordType, value: string, name: string): string | null {
    if (value === "") return "Enter a value";
    switch (type) {
        case "A":
            return z.ipv4().safeParse(value).success ? null : "Must be an IPv4 address, such as 192.168.1.10";
        case "AAAA":
            return z.ipv6().safeParse(value).success ? null : "Must be an IPv6 address, such as 2001:db8::10";
        case "CNAME": {
            const target = normaliseDnsName(value);
            const error = dnsNameError(target);
            if (error) return error;
            return target === name ? "A CNAME cannot point to its own name" : null;
        }
    }
}

/** The value as it is stored: a name normalised, an IPv6 address in lower case. */
export function normaliseRecordValue(type: RecordType, value: string): string {
    const trimmed = value.trim();
    return type === "CNAME" ? normaliseDnsName(trimmed) : trimmed.toLowerCase();
}

/**
 * How a record is written to one provider: its TTL (null is the provider's own default) and
 * Cloudflare's orange cloud. A provider without a setting gets the defaults; a field the
 * provider does not know is ignored there.
 */
export const RecordSettingSchema = z.object({
    providerId: z.string().min(1),
    ttl: z
        .number()
        .int({ error: "Whole seconds" })
        .min(TTL_MIN, { error: `At least ${TTL_MIN} seconds` })
        .max(TTL_MAX, { error: `At most ${TTL_MAX} seconds` })
        .nullable()
        .default(null),
    proxied: z.boolean().default(false),
});

/**
 * `POST /api/v1/records` and `PUT /api/v1/records/:recordId`. A record is one name, type and
 * value; the same name with another value is another record -- several A records for round
 * robin, or the same name in two sites with two answers (split horizon).
 *
 * `settings` hold TTL and proxy per provider, one each; one that only says the defaults is
 * dropped. A record without a site is parked: dpm keeps it and writes it to no provider.
 */
export const RecordInputSchema = z
    .object({
        name: dnsName(true),
        type: z.enum(RECORD_TYPES),
        value: z.string().trim(),
        settings: z
            .array(RecordSettingSchema)
            .default([])
            .refine((settings) => new Set(settings.map((s) => s.providerId)).size === settings.length, {
                error: "One setting per provider",
            })
            .transform((settings) => settings.filter((s) => s.ttl !== null || s.proxied)),
        siteIds: z.array(z.string().min(1)).transform(unique),
        note: z.string().trim().max(500).default(""),
    })
    .superRefine((record, ctx) => {
        const error = recordValueError(record.type, record.value, record.name);
        if (error) ctx.addIssue({ code: "custom", path: ["value"], message: error });
    })
    .transform((record) => ({ ...record, value: normaliseRecordValue(record.type, record.value) }));

/** `POST /api/v1/sites` and `PUT /api/v1/sites/:siteId`: a group of providers that give the same answers. */
export const SiteInputSchema = z.object({
    name: EntityNameSchema,
    description: z.string().trim().max(500).default(""),
    providerIds: z.array(z.string().min(1)).default([]).transform(unique),
});

/**
 * Why `text` is not a `host` or `host:port`, or null. The host is a name, an IPv4 address or
 * an IPv6 address in brackets.
 */
export function hostPortError(text: string): string | null {
    const match = /^(\[[^\]]+\]|[^:[\]\s]+)(?::(\d{1,5}))?$/.exec(text);
    if (!match) return `"${text}" is not a host or host:port`;
    const [, host, port] = match;
    if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return `Port ${port} is not between 1 and 65535`;
    if (host.startsWith("[")) {
        return z.ipv6().safeParse(host.slice(1, -1)).success ? null : `${host} is not an IPv6 address`;
    }
    if (/^[\d.]+$/.test(host)) {
        return z.ipv4().safeParse(host).success ? null : `${host} is not an IPv4 address`;
    }
    return dnsNameError(normaliseDnsName(host));
}

const HostPortSchema = z
    .string()
    .trim()
    .superRefine((text, ctx) => {
        const error = hostPortError(text);
        if (error) ctx.addIssue({ code: "custom", message: error });
    });

/**
 * A provider's secret -- the Cloudflare API token, the AdGuard Home or Samba AD password.
 * Left out on an update, the stored one stays; a new provider needs one, which the server
 * checks (`providerSecretMissing`). Never sent back: a provider says only `hasSecret`.
 */
const SecretInputSchema = z.string().min(1, { error: "Enter it, or leave the field untouched" }).optional();

const providerCommon = {
    name: EntityNameSchema,
    /** Whether drift is written back by itself. Off: drift is reported and waits for a decision. */
    autoCorrect: z.boolean().default(false),
    /** Read and compared, never written: nothing is created, changed or deleted there. */
    readOnly: z.boolean().default(false),
    secret: SecretInputSchema,
};

/**
 * `POST /api/v1/providers` and `PUT /api/v1/providers/:providerId`, one shape per type. The
 * type of a provider is fixed once it exists.
 */
export const ProviderInputSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("cloudflare"),
        ...providerCommon,
        zoneMode: z.enum(ZONE_MODES).default("all"),
        /**
         * The zones ticked under "Selected zones", by Cloudflare's zone id. Kept while the mode
         * is "all", so switching back and forth does not lose the choice.
         */
        zoneIds: z.array(z.string().min(1)).default([]).transform(unique),
    }),
    z.object({
        type: z.literal("adguard"),
        ...providerCommon,
        /** Where AdGuard Home's web interface answers, e.g. `http://192.168.1.2:3000`. */
        url: z
            .string()
            .trim()
            .pipe(z.url({ protocol: /^https?$/, error: "Must be an http:// or https:// URL" })),
        username: z.string().trim().min(1, { error: "Enter the user name" }),
        /** Accept a certificate that does not validate, for an https:// URL. */
        allowSelfSigned: z.boolean().default(false),
    }),
    z.object({
        type: z.literal("samba-ad"),
        ...providerCommon,
        /** The domain controllers to talk LDAPS to, in this order; port 636 unless named. */
        servers: z.array(HostPortSchema).min(1, { error: "Name at least one domain controller" }),
        /** The service account, as `user@domain` or a DN. */
        username: z.string().trim().min(1, { error: "Enter the service account" }),
        allowSelfSigned: z.boolean().default(false),
    }),
]);

/** Why a new provider cannot be created without more: it has no secret yet. */
export function providerSecretMissing(input: { type: string; secret?: string }): string | null {
    if (input.secret) return null;
    return input.type === "cloudflare" ? "Enter the API token" : "Enter the password";
}

/**
 * `POST /api/v1/providers/test`: a provider as the editor holds it, saved or not. `id` names
 * the stored provider whose secret stands in while the editor's secret field is empty.
 */
export const ProviderTestRequestSchema = z.object({
    id: z.string().min(1).optional(),
    provider: ProviderInputSchema,
});

/**
 * `POST /api/v1/records/preview`: what saving a record as the editor holds it would do at each
 * provider, or what deleting the stored record `id` would. Changes nothing.
 */
export const RecordPreviewRequestSchema = z.union([
    z.object({ id: z.string().min(1).optional(), record: RecordInputSchema }),
    z.object({ id: z.string().min(1), delete: z.literal(true) }),
]);

/**
 * `POST /api/v1/records/sites`: sites to give several records, and sites to take from them.
 * What a record already has, or does not have, stays as it is. A site cannot be in both.
 */
export const RecordSitesRequestSchema = z
    .object({
        recordIds: z.array(z.string().min(1)).min(1, { error: "Choose at least one record" }).max(1000).transform(unique),
        add: z.array(z.string().min(1)).default([]).transform(unique),
        remove: z.array(z.string().min(1)).default([]).transform(unique),
    })
    .refine((request) => request.add.length > 0 || request.remove.length > 0, { error: "Choose a site to add or remove" })
    .refine((request) => !request.add.some((id) => request.remove.includes(id)), {
        error: "A site cannot be added and removed at once",
    });

/** `POST /api/v1/sites/preview`: what saving a site as the editor holds it would do to its records. */
export const SitePreviewRequestSchema = z.object({
    id: z.string().min(1).optional(),
    site: SiteInputSchema,
});

/** One entry a provider holds, as the unmanaged list names it. */
export const UnmanagedRefSchema = z.object({
    providerId: z.string().min(1),
    externalId: z.string().min(1),
});

/**
 * `POST /api/v1/unmanaged/adopt`: entries to take over, into one site. The site has to be one
 * of each entry's provider, so that dpm takes over what it will write there.
 */
export const AdoptRequestSchema = z.object({
    siteId: z.string().min(1, { error: "Choose a site" }),
    entries: z.array(UnmanagedRefSchema).min(1, { error: "Choose at least one entry" }).max(1000),
});
