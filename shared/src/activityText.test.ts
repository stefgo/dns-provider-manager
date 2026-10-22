import { describe, expect, it } from "vitest";
import { activityDetail, activityMessage } from "./activityText.js";
import type { ActivityRecord } from "./types.js";

const event = (kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "server",
    kind,
    level: "info",
    seen: false,
    ...over,
});

describe("activityMessage", () => {
    it("names a scheduler as the settings page does", () => {
        const failed = (data: ActivityRecord["data"]) => activityMessage(event("scheduler.failed", { data }));
        expect(failed({ scheduler: "notification-cleanup", error: "disk full" })).toBe(
            "Activity cleanup failed: disk full",
        );
        // A scheduler of a newer server keeps its id.
        expect(failed({ scheduler: "backup" })).toBe("backup failed");
        expect(failed(null)).toBe("A scheduled job failed");
    });

    it("prints the kind of an event nobody here knows", () => {
        expect(activityMessage(event("record.something_new", { data: { name: "x" } }))).toBe("record.something_new");
    });
});

describe("activityDetail", () => {
    it("is the error where there is one", () => {
        expect(activityDetail(event("scheduler.failed", { data: { error: "disk full" } }))).toBe("disk full");
    });

    it("is nothing for an event without one", () => {
        expect(activityDetail(event("scheduler.failed"))).toBeNull();
        expect(activityDetail(event("scheduler.failed", { data: { error: "" } }))).toBeNull();
    });
});
