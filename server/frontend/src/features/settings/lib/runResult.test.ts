import { describe, expect, it } from "vitest";
import { describeRunResult } from "./runResult";

const run = { trigger: "schedule" as const, startedAt: "2026-10-22T10:00:00Z", finishedAt: "2026-10-22T10:00:01Z", error: null };

describe("describeRunResult", () => {
    it("words what each scheduler reports", () => {
        expect(describeRunResult({ ...run, status: "success", result: { removed: 3 } })).toBe("3 removed");
        expect(describeRunResult({ ...run, status: "success", result: { read: 2, failed: 0 } })).toBe("2 read");
        expect(describeRunResult({ ...run, status: "partial", result: { read: 2, failed: 1 } })).toBe("2 read, 1 failed");
    });

    it("gives the error of a failed run", () => {
        expect(describeRunResult({ ...run, status: "failed", result: null, error: "disk full" })).toBe("disk full");
        expect(describeRunResult({ ...run, status: "interrupted", result: null, finishedAt: null })).toBe("Interrupted");
    });
});
