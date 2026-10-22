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

describe("activityMessage: changes made by a user", () => {
    it("names a record by name, type and value, and who changed it", () => {
        const data = { user: "admin", name: "app.example.com", type: "A", value: "192.168.1.10" };
        expect(activityMessage(event("record.created", { source: "user", data }))).toBe(
            "Record app.example.com A 192.168.1.10 added by admin",
        );
        expect(activityMessage(event("record.deleted", { data: { ...data, user: undefined } }))).toBe(
            "Record app.example.com A 192.168.1.10 deleted",
        );
    });

    it("names a site and a provider", () => {
        expect(activityMessage(event("site.changed", { data: { user: "admin", name: "internal" } }))).toBe(
            "Site internal changed by admin",
        );
        expect(activityMessage(event("provider.deleted", { data: { name: "AdGuard 1" } }))).toBe("Provider AdGuard 1 deleted");
    });

    it("still reads as something without its facts", () => {
        expect(activityMessage(event("record.created"))).toBe("Record A record added");
        expect(activityMessage(event("site.created"))).toBe("Site ? added");
    });
});

describe("activityDetail", () => {
    it("lists what a change changed", () => {
        const changes = [
            { field: "value", from: "192.168.1.10", to: "192.168.1.11" },
            { field: "sites", from: "internal", to: "internal, external" },
            { field: "broken" },
        ];
        expect(activityDetail(event("record.changed", { data: { changes } }))).toBe(
            "value: 192.168.1.10 → 192.168.1.11 · sites: internal → internal, external",
        );
    });

    it("names the sites of a record and the providers of a site", () => {
        expect(activityDetail(event("record.created", { data: { sites: ["internal", "external"] } }))).toBe(
            "Sites: internal, external",
        );
        expect(activityDetail(event("site.created", { data: { providers: ["AdGuard 1"] } }))).toBe("Providers: AdGuard 1");
    });

    it("is the error where there is one", () => {
        expect(activityDetail(event("scheduler.failed", { data: { error: "disk full" } }))).toBe("disk full");
    });

    it("is nothing for an event without one", () => {
        expect(activityDetail(event("scheduler.failed"))).toBeNull();
        expect(activityDetail(event("scheduler.failed", { data: { error: "" } }))).toBeNull();
    });
});
