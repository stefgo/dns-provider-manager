import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@dpm/shared";
import { problemSummary, unseenProblems } from "./dashboard";

const event = (id: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id,
    kind: "scheduler.failed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:00.000Z",
    source: "server",
    level: "info",
    seen: false,
    ...over,
});

describe("unseenProblems", () => {
    it("counts the unseen rows at warning and above", () => {
        const events = [
            event("a", { level: "error" }),
            event("b", { level: "warning" }),
            event("c", { level: "info" }),
            event("d", { level: "error", seen: true }),
        ];
        expect(unseenProblems(events)).toEqual({ errors: 1, warnings: 1 });
    });

    it("counts a group as one row, at the most severe level in it", () => {
        const events = [
            event("a", { level: "error", correlationId: "i1" }),
            event("b", { level: "warning", correlationId: "i1" }),
        ];
        expect(unseenProblems(events)).toEqual({ errors: 1, warnings: 0 });
    });
});

describe("problemSummary", () => {
    it("names what the number is made of and leaves out a part that is zero", () => {
        expect(problemSummary({ errors: 1, warnings: 2 })).toBe("1 error · 2 warnings");
        expect(problemSummary({ errors: 0, warnings: 1 })).toBe("1 warning");
    });

    it("says so when nothing is unseen", () => {
        expect(problemSummary({ errors: 0, warnings: 0 })).toBe("Nothing unseen");
    });
});
