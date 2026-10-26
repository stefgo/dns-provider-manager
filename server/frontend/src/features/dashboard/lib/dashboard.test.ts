import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@dpm/shared";
import {
    formatReachable,
    problemSummary,
    providerCount,
    providerSummary,
    recordSummary,
    recordSummaryText,
    siteTileSummary,
    siteTiles,
    unseenProblems,
} from "./dashboard";
import { link, provider, record, site } from "./testFixtures";

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

describe("providerCount", () => {
    it("tells reachable, unreachable and never read apart", () => {
        const count = providerCount([
            provider("a"),
            provider("b", { lastError: "down" }),
            provider("c", { lastSeenAt: null }),
        ]);
        expect(count).toEqual({ total: 3, reachable: 1, unreachable: 1, notRead: 1 });
        expect(formatReachable(count)).toBe("1 / 3");
        expect(providerSummary(count)).toBe("1 unreachable · 1 not read yet");
    });

    it("says so when all are reachable, or there is none", () => {
        expect(providerSummary(providerCount([provider("a")]))).toBe("All reachable");
        expect(providerSummary(providerCount([]))).toBe("No provider yet");
    });
});

describe("recordSummary", () => {
    it("counts by the states of the record list's filter", () => {
        const summary = recordSummary([
            record("ok"),
            record("drift", { links: [link({ status: "drift" })] }),
            record("pending", { links: [link({ status: "pending" })] }),
            record("parked", { siteIds: [], links: [] }),
            record("nowhere", { links: [] }),
        ]);
        expect(summary).toEqual({ total: 5, problems: 1, failed: false, inProgress: 1, parked: 1, noTarget: 1 });
        expect(recordSummaryText(summary)).toBe("1 with problems · 1 in progress · 1 at no provider · 1 parked");
    });

    it("tells a failed write from a change at a provider", () => {
        expect(recordSummary([record("w", { links: [link({ status: "error" })] })]).failed).toBe(true);
        expect(recordSummary([record("r", { links: [link({ status: "removing", error: "down" })] })]).failed).toBe(true);
    });

    it("says so when all are in sync, or there is none", () => {
        expect(recordSummaryText(recordSummary([record("ok")]))).toBe("All in sync");
        expect(recordSummaryText(recordSummary([]))).toBe("No record yet");
    });
});

describe("siteTiles", () => {
    it("gives every site its providers in the provider list's order and counts its problems", () => {
        const tiles = siteTiles(
            [site("internal", { providerIds: ["b", "a"], recordCount: 3 }), site("external", { providerIds: [], recordCount: 0 })],
            [provider("a"), provider("b", { lastError: "down", writable: false })],
            [
                record("ok"),
                record("w", { links: [link({ status: "error" })] }),
                record("d", { siteIds: ["other"], links: [link({ status: "drift" })] }),
            ],
        );
        expect(tiles).toEqual([
            {
                id: "internal",
                name: "internal",
                records: 3,
                problems: 1,
                failed: true,
                providers: [
                    { id: "a", name: "AdGuard a", tone: "success", writable: true },
                    { id: "b", name: "AdGuard b", tone: "error", writable: false },
                ],
            },
            { id: "external", name: "external", records: 0, problems: 0, failed: false, providers: [] },
        ]);
    });

    it("sums a tile up at its foot", () => {
        const one = [{ id: "a", name: "a", tone: "success" as const, writable: true }];
        expect(siteTileSummary({ records: 3, problems: 2, providers: one })).toBe("2 records with problems");
        expect(siteTileSummary({ records: 3, problems: 0, providers: one })).toBe("All in sync");
        expect(siteTileSummary({ records: 0, problems: 0, providers: one })).toBe("No records");
        expect(siteTileSummary({ records: 2, problems: 0, providers: [] })).toBe("No provider");
    });
});
