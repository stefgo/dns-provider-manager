import { describe, expect, it } from "vitest";
import { RecordInputSchema, type DnsRecord } from "@dpm/shared";
import { checkDraft } from "../../../lib/entityForm";
import {
    EMPTY_RECORD_DRAFT,
    reachesCloudflare,
    recordDraftFrom,
    recordInputFrom,
    recordRules,
    type RecordDraft,
} from "./recordForm";

const rules = { schema: RecordInputSchema, toInput: recordInputFrom, rules: recordRules };
const check = (over: Partial<RecordDraft>) =>
    checkDraft(rules, { ...EMPTY_RECORD_DRAFT, name: "app.example.com", value: "192.168.1.10", siteIds: ["s1"], ...over });

describe("recordInputFrom", () => {
    it("sends an empty TTL as the provider's default and a number as itself", () => {
        expect(recordInputFrom({ ...EMPTY_RECORD_DRAFT, ttl: " " }).ttl).toBeNull();
        expect(recordInputFrom({ ...EMPTY_RECORD_DRAFT, ttl: "300" }).ttl).toBe(300);
    });

    it("is what recordDraftFrom read", () => {
        const record: DnsRecord = {
            id: "r1",
            name: "app.example.com",
            type: "AAAA",
            value: "2001:db8::10",
            ttl: 3600,
            proxied: true,
            note: "web",
            siteIds: ["s1"],
            createdAt: "2026-10-22T10:00:00Z",
            createdBy: "admin",
            updatedAt: null,
            updatedBy: null,
            links: [],
            skipped: [],
        };
        expect(recordInputFrom(recordDraftFrom(record))).toEqual({
            name: "app.example.com",
            type: "AAAA",
            value: "2001:db8::10",
            ttl: 3600,
            proxied: true,
            siteIds: ["s1"],
            note: "web",
        });
    });
});

describe("the record editor's check", () => {
    it("takes a valid draft", () => {
        expect(check({}).isValid).toBe(true);
    });

    it("says at the field what the server would refuse", () => {
        expect(check({ value: "2001:db8::1" }).errors.value).toMatch(/IPv4/);
        expect(check({ name: "app..example.com" }).errors.name).toMatch(/empty part/);
        expect(check({ siteIds: [] }).errors.siteIds).toBe("Choose at least one site");
        expect(check({ ttl: "10" }).errors.ttl).toBe("At least 60 seconds");
    });

    it("names a TTL that is no number in its own words", () => {
        expect(check({ ttl: "5m" }).errors.ttl).toBe("Whole seconds, or empty for the provider's default");
    });
});

describe("reachesCloudflare", () => {
    const sites = [
        { id: "int", providerIds: ["ag"] },
        { id: "ext", providerIds: ["cf"] },
    ];
    const providers = [
        { id: "ag", type: "adguard" as const },
        { id: "cf", type: "cloudflare" as const },
    ];

    it("is true when one of the sites writes to Cloudflare", () => {
        expect(reachesCloudflare(["int"], sites, providers)).toBe(false);
        expect(reachesCloudflare(["int", "ext"], sites, providers)).toBe(true);
        expect(reachesCloudflare([], sites, providers)).toBe(false);
    });
});
