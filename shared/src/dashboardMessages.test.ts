import { describe, expect, it } from "vitest";
import { WS_EVENTS } from "./constants.js";
import { DashboardMessageSchema } from "./dashboardMessages.js";

const event = {
    id: "e1",
    source: "server",
    level: "error",
    kind: "scheduler.failed",
    subject: {},
    occurredAt: "2026-10-04T08:00:00Z",
    receivedAt: "2026-10-04T08:00:01Z",
    seen: false,
};

describe("DashboardMessageSchema", () => {
    it("takes the activity list and the seen ids", () => {
        expect(DashboardMessageSchema.safeParse({ type: WS_EVENTS.ACTIVITY_UPDATE, payload: [] }).success).toBe(true);
        expect(
            DashboardMessageSchema.safeParse({ type: WS_EVENTS.ACTIVITY_SEEN, payload: { ids: ["e1"] } }).success,
        ).toBe(true);
    });

    it("refuses a type it does not list", () => {
        expect(DashboardMessageSchema.safeParse({ type: "CLIENTS_UPDATE", payload: [] }).success).toBe(false);
    });

    it("refuses a payload that does not belong to its type", () => {
        expect(DashboardMessageSchema.safeParse({ type: WS_EVENTS.ACTIVITY_APPENDED, payload: [{ id: "e1" }] }).success).toBe(
            false,
        );
        expect(DashboardMessageSchema.safeParse({ type: WS_EVENTS.ACTIVITY_SEEN, payload: [] }).success).toBe(false);
    });
});

describe("the activity messages", () => {
    it("take a stored event", () => {
        const parsed = DashboardMessageSchema.safeParse({ type: WS_EVENTS.ACTIVITY_APPENDED, payload: [event] });
        expect(parsed.error?.issues).toBeUndefined();
    });
});
