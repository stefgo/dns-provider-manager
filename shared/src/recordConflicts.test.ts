import { describe, expect, it } from "vitest";
import { recordConflict, type ConflictRecord } from "./recordConflicts.js";

const sites = [
    { id: "int", name: "internal", providerIds: ["ag1", "ag2"] },
    { id: "ext", name: "external", providerIds: ["cf"] },
    { id: "lab", name: "lab", providerIds: ["ag2"] },
];
const providers = [
    { id: "ag1", name: "AdGuard 1" },
    { id: "ag2", name: "AdGuard 2" },
    { id: "cf", name: "Cloudflare" },
];

const record = (over: Partial<ConflictRecord>): ConflictRecord => ({
    name: "app.example.com",
    type: "A",
    value: "192.168.1.10",
    siteIds: ["int"],
    ...over,
});

describe("recordConflict", () => {
    it("allows several A records of one name: round robin", () => {
        const existing = [record({ id: "r1" })];
        expect(recordConflict(record({ value: "192.168.1.11" }), existing, sites, providers)).toBeNull();
    });

    it("allows the same name with another answer in a site that never meets: split horizon", () => {
        const existing = [record({ id: "r1" })];
        const outside = record({ value: "203.0.113.10", siteIds: ["ext"] });
        expect(recordConflict(outside, existing, sites, providers)).toBeNull();
        // A CNAME too, as long as no DNS server would answer both.
        expect(recordConflict(record({ type: "CNAME", value: "web.example.net", siteIds: ["ext"] }), existing, sites)).toBeNull();
    });

    it("refuses the same name, type and value twice, whatever the sites", () => {
        const existing = [record({ id: "r1" })];
        expect(recordConflict(record({ siteIds: ["ext"] }), existing, sites, providers)).toBe(
            "app.example.com A 192.168.1.10 exists already; add the site to that record instead",
        );
    });

    it("refuses a CNAME beside another record in the same site", () => {
        const existing = [record({ id: "r1", type: "AAAA", value: "2001:db8::10" })];
        expect(recordConflict(record({ type: "CNAME", value: "web.example.com" }), existing, sites, providers)).toBe(
            'app.example.com has an AAAA record in the site "internal" already, and a CNAME cannot stand beside another record of its name',
        );
    });

    it("refuses another record beside a CNAME, and a second CNAME", () => {
        const existing = [record({ id: "r1", type: "CNAME", value: "web.example.com" })];
        expect(recordConflict(record({}), existing, sites, providers)).toMatch(/has a CNAME to web.example.com in the site "internal"/);
        expect(recordConflict(record({ type: "CNAME", value: "other.example.com" }), existing, sites, providers)).not.toBeNull();
    });

    it("finds the provider two sites share", () => {
        const existing = [record({ id: "r1", siteIds: ["lab"] })];
        expect(recordConflict(record({ type: "CNAME", value: "web.example.com" }), existing, sites, providers)).toMatch(
            /in the provider "AdGuard 2" already/,
        );
    });

    it("does not compare a record with itself", () => {
        const stored = record({ id: "r1", type: "CNAME", value: "web.example.com" });
        expect(recordConflict({ ...stored, value: "other.example.com" }, [stored], sites, providers)).toBeNull();
    });

    it("leaves other names alone", () => {
        const existing = [record({ id: "r1", name: "db.example.com" })];
        expect(recordConflict(record({ type: "CNAME", value: "web.example.com" }), existing, sites, providers)).toBeNull();
    });
});
