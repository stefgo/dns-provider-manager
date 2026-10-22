import { describe, expect, it } from "vitest";
import type { ProviderEntry } from "../providers/DnsProvider.js";
import { unmanagedEntries } from "./unmanaged.js";
import { claimKey } from "./syncPlan.js";

const entry = (over: Partial<ProviderEntry>): ProviderEntry => ({
    externalId: "e1",
    zoneId: "z1",
    zone: "example.com",
    name: "app.example.com",
    type: "A",
    value: "203.0.113.10",
    ttl: null,
    proxied: false,
    disabled: false,
    ...over,
});
const cf = { id: "cf", zones: [{ id: "z1", name: "example.com", selected: false, owner: "cf" }] };
const sites = [
    { id: "ext", providerIds: ["cf"] },
    { id: "int", providerIds: ["ag"] },
];

describe("unmanagedEntries", () => {
    it("lists what dpm has no record for, with nothing to stop adopting it", () => {
        const [only] = unmanagedEntries(new Map([["cf", [entry({})]]]), [cf], [], sites);
        expect(only).toMatchObject({ providerId: "cf", externalId: "e1", zone: "example.com", recordId: null, problem: null });
    });

    it("leaves out what a record in a site of the provider stands for", () => {
        const records = [{ id: "r1", name: "app.example.com", type: "A" as const, value: "203.0.113.10", siteIds: ["ext"] }];
        expect(unmanagedEntries(new Map([["cf", [entry({})]]]), [cf], records, sites)).toEqual([]);
    });

    it("leaves out what a record holds, and what is switched off", () => {
        const readings = new Map([["cf", [entry({}), entry({ externalId: "e2", value: "203.0.113.11", disabled: true })]]]);
        expect(unmanagedEntries(readings, [cf], [], sites, new Set([claimKey("cf", "e1")]))).toEqual([]);
    });

    it("names the record dpm has in other sites only", () => {
        const records = [{ id: "r1", name: "app.example.com", type: "A" as const, value: "203.0.113.10", siteIds: ["int"] }];
        expect(unmanagedEntries(new Map([["cf", [entry({})]]]), [cf], records, sites)[0].recordId).toBe("r1");
    });

    it("leaves out the zones another provider uses now", () => {
        const taken = { id: "cf", zones: [{ id: "z1", name: "example.com", selected: false, owner: "cf2" }] };
        expect(unmanagedEntries(new Map([["cf", [entry({})]]]), [taken], [], sites)).toEqual([]);
    });

    it("says why an entry cannot be taken over", () => {
        const [odd] = unmanagedEntries(new Map([["cf", [entry({ name: "_dmarc-host.example.com" })]]]), [cf], [], sites);
        expect(odd.problem).toMatch(/only letters, digits and hyphens/);
    });

    it("orders the entries by name, type and value", () => {
        const entries = [entry({ externalId: "b", name: "b.example.com" }), entry({ externalId: "a", name: "a.example.com" })];
        expect(unmanagedEntries(new Map([["cf", entries]]), [cf], [], sites).map((e) => e.externalId)).toEqual(["a", "b"]);
    });
});
