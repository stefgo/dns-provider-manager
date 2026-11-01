import { describe, expect, it } from "vitest";
import { readAllOutcome, readOutcome } from "./readOutcome";

describe("readOutcome", () => {
    it("names the records a provider holds", () => {
        expect(readOutcome("Cloudflare", { error: null, recordCount: 12 })).toEqual({
            variant: "success",
            title: "Cloudflare read",
            description: "12 records",
        });
        expect(readOutcome("Cloudflare", { error: null, recordCount: 1 }).description).toBe("1 record");
    });

    it("says why a provider could not be read, until it is closed", () => {
        expect(readOutcome("AdGuard", { error: "connect ECONNREFUSED", recordCount: 0 })).toEqual({
            variant: "error",
            title: "Could not read AdGuard",
            description: "connect ECONNREFUSED",
            duration: 0,
        });
    });
});

describe("readAllOutcome", () => {
    it("counts the providers read", () => {
        expect(readAllOutcome({ read: 3, failed: 0 })).toEqual({ variant: "success", title: "3 providers read" });
        expect(readAllOutcome({})).toEqual({ variant: "success", title: "0 providers read" });
    });

    it("warns about the providers that could not be read, until it is closed", () => {
        expect(readAllOutcome({ read: 2, failed: 1 })).toEqual({
            variant: "warning",
            title: "1 provider could not be read",
            description: "2 providers read",
            duration: 0,
        });
    });
});
