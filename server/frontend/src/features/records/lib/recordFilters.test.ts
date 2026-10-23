import { describe, expect, it } from "vitest";
import type { RecordLinkView } from "@dpm/shared";
import { matchesSite, matchesStatus, parseSiteFilter, parseStatusFilter, siteFilterOptions, statusFilterOptions } from "./recordFilters";

const link = (over: Partial<RecordLinkView>): RecordLinkView => ({
    providerId: "a",
    status: "in_sync",
    error: null,
    observed: null,
    syncedAt: null,
    ...over,
});
const sites = [
    { id: "s1", name: "internal" },
    { id: "s2", name: "external" },
];

describe("the site filter", () => {
    it("keeps the records of one site, or those without one", () => {
        expect(matchesSite({ siteIds: ["s1", "s2"] }, "s2")).toBe(true);
        expect(matchesSite({ siteIds: ["s1"] }, "s2")).toBe(false);
        expect(matchesSite({ siteIds: [] }, "parked")).toBe(true);
        expect(matchesSite({ siteIds: ["s1"] }, "parked")).toBe(false);
        expect(matchesSite({ siteIds: [] }, "all")).toBe(true);
    });

    it("falls back to every site for one that is gone", () => {
        expect(parseSiteFilter("s1", sites)).toBe("s1");
        expect(parseSiteFilter("parked", sites)).toBe("parked");
        expect(parseSiteFilter("gone", sites)).toBe("all");
        expect(parseSiteFilter("", sites)).toBe("all");
    });

    it("offers the sites in their order, between every site and the parked records", () => {
        expect(siteFilterOptions(sites).map((o) => o.value)).toEqual(["all", "s1", "s2", "parked"]);
    });
});

describe("the status filter", () => {
    it("keeps a record in sync only when it is in sync at every provider", () => {
        expect(matchesStatus({ links: [link({}), link({})] }, "in_sync")).toBe(true);
        expect(matchesStatus({ links: [link({}), link({ status: "pending" })] }, "in_sync")).toBe(false);
        expect(matchesStatus({ links: [] }, "in_sync")).toBe(false);
    });

    it("puts a problem anywhere before what is still under way", () => {
        const failedOnce = { links: [link({}), link({ status: "error" }), link({ status: "pending" })] };
        expect(matchesStatus(failedOnce, "problems")).toBe(true);
        expect(matchesStatus(failedOnce, "in_progress")).toBe(false);
        expect(matchesStatus({ links: [link({ status: "drift" })] }, "problems")).toBe(true);
    });

    it("counts what is not written yet or being removed as under way, a failed removal as a problem", () => {
        expect(matchesStatus({ links: [link({}), link({ status: "pending" })] }, "in_progress")).toBe(true);
        expect(matchesStatus({ links: [link({ status: "removing" })] }, "in_progress")).toBe(true);
        expect(matchesStatus({ links: [link({ status: "pending", error: "Read only" })] }, "problems")).toBe(false);
        expect(matchesStatus({ links: [link({ status: "removing", error: "down" })] }, "in_progress")).toBe(false);
        expect(matchesStatus({ links: [link({ status: "removing", error: "down" })] }, "problems")).toBe(true);
    });

    it("leaves a record that goes to no provider to every state", () => {
        for (const filter of ["in_sync", "problems", "in_progress"] as const) expect(matchesStatus({ links: [] }, filter)).toBe(false);
        expect(matchesStatus({ links: [] }, "all")).toBe(true);
    });

    it("reads every choice it offers back from the address, and nothing else", () => {
        for (const { value } of statusFilterOptions()) expect(parseStatusFilter(value)).toBe(value);
        expect(parseStatusFilter("bogus")).toBe("all");
    });
});
