import { describe, expect, it } from "vitest";
import type { RecordLinkView } from "@dpm/shared";
import { recordCounts } from "./providerRecords";

const link = (providerId: string, status: RecordLinkView["status"], error: string | null = null): RecordLinkView => ({
    providerId,
    status,
    error,
    observed: null,
    syncedAt: null,
});

describe("recordCounts", () => {
    it("counts the records of each provider and those that need a look", () => {
        const counts = recordCounts([
            { links: [link("a", "in_sync"), link("b", "drift")] },
            { links: [link("a", "error", "down"), link("b", "removing")] },
            { links: [link("b", "removing", "down")] },
        ]);
        expect(counts.get("a")).toEqual({ total: 2, problems: 1 });
        expect(counts.get("b")).toEqual({ total: 1, problems: 2 });
    });
});
