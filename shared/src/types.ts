import { z } from "zod";
import {
    ACTIVITY_KINDS,
    ACTIVITY_LEVELS,
    ACTIVITY_SOURCES,
    LINK_STATUSES,
    PROVIDER_TYPES,
    RECORD_TYPES,
    SCHEDULER_IDS,
    SCHEDULER_RUN_STATUSES,
    SCHEDULER_TRIGGERS,
    SYNC_ACTIONS,
} from "./constants.js";
import {
    LoginPayloadSchema,
    CreateUserSchema,
    UpdateUserSchema,
    CleanupSettingsSchema,
    ActivityEventSchema,
    ActivityRecordSchema,
    ActivitySubjectSchema,
    WebhookInputSchema,
    WebhookSchema,
    RecordInputSchema,
    RecordSettingSchema,
    SiteInputSchema,
    ProviderInputSchema,
    AdoptRequestSchema,
    ProviderTestRequestSchema,
    RecordPreviewRequestSchema,
    RecordSitesRequestSchema,
    SitePreviewRequestSchema,
} from "./schemas.js";
import {
    AdoptResultSchema,
    RecordSitesResultSchema,
    ObservedEntrySchema,
    PendingRemovalSchema,
    RecordLinkViewSchema,
    RecordPreviewSchema,
    SitePreviewSchema,
    SkippedProviderSchema,
    SyncStepViewSchema,
    ProviderTestResultSchema,
    ProviderZoneViewSchema,
    ReadingViewSchema,
    UnmanagedEntrySchema,
    UnmanagedResponseSchema,
    ProviderViewSchema,
    RecordViewSchema,
    SiteViewSchema,
    SchedulerStatusUpdateSchema,
    SchedulerStatusesSchema,
    UserSchema,
    WebhookTestResultSchema,
} from "./responses.js";

// REST request bodies
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type CleanupSettings = z.infer<typeof CleanupSettingsSchema>;

// ── Activity ─────────────────────────────────────────────────────────────────

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/**
 * The kinds this build can phrase. A stored event may carry any string -- see
 * `ActivityEventSchema` -- so this is the authoring type, not the parsing one: it is what a
 * `kind` literal in our own code is checked against.
 */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivitySubject = z.infer<typeof ActivitySubjectSchema>;

/**
 * One event as it is recorded. There is no message in here: the text is written by
 * `activityMessage` (activityText.ts) out of `kind` and `data`, for the dashboard and the
 * webhooks alike. That is what makes filtering by kind and level exact instead of a search
 * over sentences.
 */
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/** An event as the server holds it. See `ActivityRecordSchema` for what the two times mean. */
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;

// ── Webhooks ─────────────────────────────────────────────────────────────────

export type WebhookInput = z.input<typeof WebhookInputSchema>;
export type Webhook = z.infer<typeof WebhookSchema>;

/** `POST /api/v1/webhooks/test`: what was sent, and what came back. */
export type WebhookTestResult = z.infer<typeof WebhookTestResultSchema>;

// ── Schedulers ───────────────────────────────────────────────────────────────

export type SchedulerId = (typeof SCHEDULER_IDS)[number];
export type SchedulerTrigger = (typeof SCHEDULER_TRIGGERS)[number];
export type SchedulerRunStatus = (typeof SCHEDULER_RUN_STATUSES)[number];

/** What each scheduler reports as the result of a run. */
export interface SchedulerRunResults {
    "notification-cleanup": { removed: number };
    "provider-read": { read: number; failed: number };
}

/** The last run a scheduler finished, as `scheduler_state` holds it. */
export interface SchedulerRunSummary<Id extends SchedulerId = SchedulerId> {
    trigger: SchedulerTrigger;
    status: SchedulerRunStatus;
    startedAt: string;
    /** Null for a run the server did not live to finish (`interrupted`). */
    finishedAt: string | null;
    /** Null unless the run succeeded, fully or in part. */
    result: SchedulerRunResults[Id] | null;
    error: string | null;
}

export interface SchedulerStatus<Id extends SchedulerId = SchedulerId> {
    isRunning: boolean;
    /** Null when the scheduler is switched off. */
    nextRun: string | null;
    lastRun: SchedulerRunSummary<Id> | null;
}

/** `GET /api/v1/settings/scheduler-status`: every scheduler the server runs. */
export type SchedulerStatuses = {
    [Id in SchedulerId]: SchedulerStatus<Id>;
};

/** The payload of `SCHEDULER_STATUS_UPDATE`: one scheduler, whenever a run starts or ends. */
export type SchedulerStatusUpdate = {
    [Id in SchedulerId]: { scheduler: Id; status: SchedulerStatuses[Id] };
}[SchedulerId];

/**
 * The dashboard parses `SCHEDULER_STATUS_UPDATE` with `SchedulerStatusUpdateSchema`, which
 * is written separately from the types above. This fails to compile as soon as the two
 * drift apart, in either direction.
 */
const schedulerStatusUpdateMatchesSchema: [
    (update: SchedulerStatusUpdate) => z.infer<typeof SchedulerStatusUpdateSchema>,
    (parsed: z.infer<typeof SchedulerStatusUpdateSchema>) => SchedulerStatusUpdate,
] = [(update) => update, (parsed) => parsed];
void schedulerStatusUpdateMatchesSchema;

const schedulerStatusesMatchSchema: [
    (statuses: SchedulerStatuses) => z.infer<typeof SchedulerStatusesSchema>,
    (parsed: z.infer<typeof SchedulerStatusesSchema>) => SchedulerStatuses,
] = [(statuses) => statuses, (parsed) => parsed];
void schedulerStatusesMatchSchema;

// ── Users ────────────────────────────────────────────────────────────────────

/** One row of `GET /api/v1/users`. */
export type User = z.infer<typeof UserSchema>;

// ── DNS ──────────────────────────────────────────────────────────────────────

export type RecordType = (typeof RECORD_TYPES)[number];
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** What the record editor sends, and what the server stores after parsing it. */
export type RecordInput = z.input<typeof RecordInputSchema>;
export type RecordFields = z.output<typeof RecordInputSchema>;
export type RecordSetting = z.output<typeof RecordSettingSchema>;
export type DnsRecord = z.infer<typeof RecordViewSchema>;

export type SiteInput = z.input<typeof SiteInputSchema>;
export type SiteFields = z.output<typeof SiteInputSchema>;
export type Site = z.infer<typeof SiteViewSchema>;

export type ProviderInput = z.input<typeof ProviderInputSchema>;
export type ProviderFields = z.output<typeof ProviderInputSchema>;
export type Provider = z.infer<typeof ProviderViewSchema>;
export type ProviderZone = z.infer<typeof ProviderZoneViewSchema>;
export type ProviderTestRequest = z.input<typeof ProviderTestRequestSchema>;
export type ProviderTestResult = z.infer<typeof ProviderTestResultSchema>;
export type Reading = z.infer<typeof ReadingViewSchema>;
export type UnmanagedEntry = z.infer<typeof UnmanagedEntrySchema>;
export type UnmanagedResponse = z.infer<typeof UnmanagedResponseSchema>;
export type AdoptRequest = z.input<typeof AdoptRequestSchema>;
export type AdoptResult = z.infer<typeof AdoptResultSchema>;
export type RecordSitesRequest = z.input<typeof RecordSitesRequestSchema>;
export type RecordSitesResult = z.infer<typeof RecordSitesResultSchema>;
export type LinkStatus = (typeof LINK_STATUSES)[number];
export type SyncAction = (typeof SYNC_ACTIONS)[number];
export type ObservedEntry = z.infer<typeof ObservedEntrySchema>;
export type RecordLinkView = z.infer<typeof RecordLinkViewSchema>;
export type SkippedProvider = z.infer<typeof SkippedProviderSchema>;
export type SyncStepView = z.infer<typeof SyncStepViewSchema>;
export type RecordPreview = z.infer<typeof RecordPreviewSchema>;
export type RecordPreviewRequest = z.input<typeof RecordPreviewRequestSchema>;
export type PendingRemoval = z.infer<typeof PendingRemovalSchema>;
export type SitePreview = z.infer<typeof SitePreviewSchema>;
export type SitePreviewRequest = z.input<typeof SitePreviewRequestSchema>;
