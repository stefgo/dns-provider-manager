import { describe, expect, it } from "vitest";
import type { RecordLinkView } from "@dpm/shared";
import { acceptEffect, hasProblem, holdsEntry, linkDetail, linksInOrder, overallState, providerRows, removedAt, saveOutcome } from "./recordSync";

const link = (over: Partial<RecordLinkView>): RecordLinkView => ({
    providerId: "a",
    status: "in_sync",
    error: null,
    observed: null,
    syncedAt: null,
    ...over,
});
const providers = [
    { id: "a", name: "AdGuard 1" },
    { id: "b", name: "AdGuard 2" },
];

describe("record states", () => {
    it("say what a provider holds instead", () => {
        const observed = { name: "nas.lan", value: "192.168.1.99", ttl: null, proxied: false, disabled: false };
        expect(linkDetail(link({ status: "drift", observed }))).toBe("Holds 192.168.1.99 instead");
        expect(linkDetail(link({ status: "drift", observed: { ...observed, disabled: true } }))).toBe("Switched off there (192.168.1.99)");
        expect(linkDetail(link({ status: "pending", error: "Read only" }))).toBe("Read only");
    });

    it("count what failed or drifted as a problem, but not what is held back on purpose", () => {
        expect(hasProblem({ links: [link({ status: "pending", error: "Read only" })] })).toBe(false);
        expect(hasProblem({ links: [link({ status: "removing", error: null })] })).toBe(false);
        expect(hasProblem({ links: [link({ status: "removing", error: "down" })] })).toBe(true);
        expect(hasProblem({ links: [link({ status: "missing" })] })).toBe(true);
    });

    it("sum up as the most urgent one, with at how many providers it is", () => {
        expect(overallState([])).toBeNull();
        expect(overallState([link({}), link({})])).toEqual({ tone: "success", label: "In sync" });
        expect(overallState([link({}), link({ status: "drift" }), link({ status: "error" })])).toEqual({
            tone: "error",
            label: "Writing failed (1 of 3)",
        });
        expect(overallState([link({ status: "drift" }), link({ status: "missing" })])).toEqual({
            tone: "warning",
            label: "Deleted at the provider (1 of 2)",
        });
        expect(overallState([link({ status: "removing", error: "down" }), link({ status: "pending" })])).toEqual({
            tone: "error",
            label: "Removal failed (1 of 2)",
        });
        expect(overallState([link({ status: "pending", error: "Read only" })])).toEqual({ tone: "neutral", label: "Not written yet" });
    });

    it("line up in the order of the providers", () => {
        expect(linksInOrder([link({ providerId: "x" }), link({ providerId: "b" }), link({ providerId: "a" })], providers).map((l) => l.providerId)).toEqual([
            "a",
            "b",
            "x",
        ]);
    });
});

describe("holdsEntry", () => {
    it("is true where dpm wrote or took over an entry that is still there", () => {
        const synced = "2026-10-23T10:00:00.000Z";
        expect(holdsEntry(link({ syncedAt: synced }))).toBe(true);
        expect(holdsEntry(link({ status: "drift", syncedAt: synced }))).toBe(true);
        expect(holdsEntry(link({ status: "missing", syncedAt: synced }))).toBe(false);
        expect(holdsEntry(link({ status: "pending" }))).toBe(false);
    });
});

describe("removedAt", () => {
    it("names the providers that would lose the record", () => {
        const preview = {
            steps: [
                { providerId: "a", action: "create" as const, reason: null },
                { providerId: "b", action: "delete" as const, reason: null },
            ],
        };
        expect(removedAt(preview, providers)).toEqual(["AdGuard 2"]);
        expect(removedAt(null, providers)).toEqual([]);
    });
});

describe("saveOutcome", () => {
    it("says nothing when every provider took it, and names each one that did not", () => {
        expect(saveOutcome({ links: [link({})] }, providers)).toBeNull();
        expect(saveOutcome({ links: [link({ providerId: "b", status: "error", error: "timeout" })] }, providers)).toEqual({
            variant: "warning",
            title: "Saved, but not written everywhere",
            description: "AdGuard 2: timeout\nIt is tried again after the provider's next reading.",
        });
    });
});

describe("acceptEffect", () => {
    const sites = [
        { id: "int", name: "internal", providerIds: ["a", "b"] },
        { id: "lab", name: "lab", providerIds: ["b"] },
    ];
    const links = [link({ providerId: "a", status: "missing" }), link({ providerId: "b" })];

    it("sends a changed value to every other provider", () => {
        const observed = { name: "nas.lan", value: "192.168.1.99", ttl: null, proxied: false, disabled: false };
        expect(acceptEffect({ siteIds: ["int"], links }, link({ providerId: "a", status: "drift", observed }), sites, providers)).toEqual({
            change: { value: "192.168.1.99" },
            others: ["AdGuard 2"],
        });
    });

    it("takes a deletion over by leaving the sites, and names who loses the record with them", () => {
        expect(acceptEffect({ siteIds: ["int"], links }, links[0], sites, providers)).toEqual({
            change: { leaves: ["internal"], parked: true },
            others: ["AdGuard 2"],
        });
        // lab still reaches AdGuard 2.
        expect(acceptEffect({ siteIds: ["int", "lab"], links }, links[0], sites, providers)).toEqual({
            change: { leaves: ["internal"], parked: false },
            others: [],
        });
    });
});

describe("providerRows", () => {
    const three = [...providers, { id: "c", name: "Cloudflare" }];

    it("show where the stored record stands, without a preview", () => {
        const rows = providerRows({ links: [link({ providerId: "b", status: "drift" }), link({})], skipped: [{ providerId: "c", reason: "Read only" }] }, null, three);
        expect(rows.map((r) => [r.providerId, r.state?.text, r.change, r.settable])).toEqual([
            ["a", "In sync", null, true],
            ["b", "Changed at the provider", null, true],
            ["c", "Does not get it", null, false],
        ]);
        expect(rows[1].link?.status).toBe("drift");
    });

    it("put what saving does next to it, once per provider", () => {
        const rows = providerRows(
            { links: [link({}), link({ providerId: "b" })], skipped: [] },
            { steps: [{ providerId: "a", action: "update", reason: null }, { providerId: "b", action: "delete", reason: null }], skipped: [{ providerId: "c", reason: "Not in its zones" }] },
            three,
        );
        expect(rows.map((r) => [r.providerId, r.state?.text ?? null, r.change?.text, r.settable])).toEqual([
            ["a", "In sync", "Changes it", true],
            ["b", "In sync", "Removes it", false],
            ["c", null, "Does not get it", false],
        ]);
    });

    it("offer no settings where a record being removed stays without a preview", () => {
        expect(providerRows({ links: [link({ status: "removing" })], skipped: [] }, null, three)[0].settable).toBe(false);
    });

    it("have only what saving does for a record being added", () => {
        const rows = providerRows(null, { steps: [{ providerId: "c", action: "create", reason: null }], skipped: [] }, three);
        expect(rows).toEqual([{ providerId: "c", state: null, change: { tone: "info", text: "Writes it", detail: null }, link: null, settable: true }]);
    });
});
