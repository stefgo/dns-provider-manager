import { describe, expect, it } from "vitest";
import type { RecordLinkView } from "@dpm/shared";
import { acceptEffect, hasProblem, linkDetail, linksInOrder, removedAt, saveOutcome } from "./recordSync";

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

    it("line up in the order of the providers", () => {
        expect(linksInOrder([link({ providerId: "x" }), link({ providerId: "b" }), link({ providerId: "a" })], providers).map((l) => l.providerId)).toEqual([
            "a",
            "b",
            "x",
        ]);
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
