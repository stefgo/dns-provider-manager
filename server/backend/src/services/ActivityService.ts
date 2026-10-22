import { randomUUID } from "crypto";
import {
    ActivityEvent,
    ActivityKind,
    ActivityLevel,
    ActivityLevelOverrides,
    ActivityRecord,
    ActivitySubject,
    WS_EVENTS,
    applyLevelOverride,
    parseLevelOverrides,
} from "@dpm/shared";
import { appConfig } from "../config/AppConfig.js";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { DashboardService } from "./DashboardService.js";
import { WebhookService } from "./WebhookService.js";

/**
 * Tells the dashboards about new events only. They hold the list already, and a new event is
 * the same for everyone, so a delta replaces the full list every event used to cost.
 *
 * The webhooks hear about the same events: only what was inserted just now arrives here, so
 * nothing is reported twice.
 */
function broadcastAppended(records: ActivityRecord[]): void {
    if (records.length === 0) return;
    DashboardService.broadcastToDashboard({
        type: WS_EVENTS.ACTIVITY_APPENDED,
        payload: records,
    });
    WebhookService.dispatch(records);
}

let parsedOverrides: { text: string; overrides: ActivityLevelOverrides } | null = null;

/**
 * The `activity_level_overrides` setting, read when an event is written and parsed again
 * only when its text has changed. Applied here and nowhere else, so the level in the
 * database, on the dashboards and in front of the webhooks is the same one -- and a changed
 * setting says something about the events from then on, not about the ones already stored.
 */
function levelOverrides(): ActivityLevelOverrides {
    const text = appConfig.settings.activity_level_overrides ?? "";
    if (parsedOverrides?.text !== text) {
        parsedOverrides = { text, overrides: parseLevelOverrides(text).overrides };
    }
    return parsedOverrides.overrides;
}

/** What the server reports. */
interface ServerEventInput {
    kind: ActivityKind;
    level: ActivityLevel;
    /** When it happened, if not now. */
    occurredAt?: string;
    correlationId?: string | null;
    subject?: ActivitySubject | null;
    data?: Record<string, unknown> | null;
}

export class ActivityService {
    /** The list as `userId` sees it: `seen` is theirs. */
    static list(userId: number): ActivityRecord[] {
        return ActivityRepository.list(userId);
    }

    /**
     * Records an event: something the server observed, or an action a user asked for.
     *
     * Returns `null` for a kind the settings switch off: nothing is stored and nobody is told.
     */
    static record(input: ServerEventInput): ActivityRecord | null {
        const event = applyLevelOverride<ActivityEvent>(
            {
                id: randomUUID(),
                occurredAt: input.occurredAt ?? new Date().toISOString(),
                source: "server",
                kind: input.kind,
                level: input.level,
                correlationId: input.correlationId ?? null,
                subject: input.subject ?? null,
                data: input.data ?? null,
            },
            levelOverrides(),
        );
        if (!event) return null;
        const { inserted } = ActivityRepository.insertMany([event], event.occurredAt);
        broadcastAppended(inserted);
        return inserted[0];
    }

    /**
     * Tells the sessions of `userId` which events turned seen -- only theirs: what one user
     * has seen changes nobody else's list. Nothing is sent when nothing changed.
     */
    static markManySeen(ids: string[], userId: number): void {
        const marked = ActivityRepository.markManySeen(ids, userId);
        if (marked.length === 0) return;
        DashboardService.sendToUser(userId, {
            type: WS_EVENTS.ACTIVITY_SEEN,
            payload: { ids: marked },
        });
    }

    /** An empty list is the same for everyone, so it goes to every dashboard. */
    static deleteAll(): void {
        ActivityRepository.deleteAll();
        DashboardService.broadcastToDashboard({
            type: WS_EVENTS.ACTIVITY_UPDATE,
            payload: [],
        });
    }
}
