import { describe, expect, it } from "vitest";
import { RecordInputSchema, type DnsRecord } from "@dpm/shared";
import { checkDraft } from "../../../lib/entityForm";
import {
    EMPTY_RECORD_DRAFT,
    recordDraftFrom,
    recordInputFrom,
    recordRules,
    settingErrors,
    withSetting,
    type RecordDraft,
} from "./recordForm";

const rules = { schema: RecordInputSchema, toInput: recordInputFrom, rules: recordRules };
const check = (over: Partial<RecordDraft>) =>
    checkDraft(rules, { ...EMPTY_RECORD_DRAFT, name: "app.example.com", value: "192.168.1.10", siteIds: ["s1"], ...over });

describe("recordInputFrom", () => {
    it("sends an empty TTL as the provider's default and a number as itself", () => {
        const input = recordInputFrom({
            ...EMPTY_RECORD_DRAFT,
            settings: { cf: { ttl: " ", proxied: true }, sa: { ttl: "300", proxied: false } },
        });
        expect(input.settings).toEqual([
            { providerId: "cf", ttl: null, proxied: true },
            { providerId: "sa", ttl: 300, proxied: false },
        ]);
    });

    it("is what recordDraftFrom read", () => {
        const record: DnsRecord = {
            id: "r1",
            name: "app.example.com",
            type: "AAAA",
            value: "2001:db8::10",
            settings: [{ providerId: "cf", ttl: 3600, proxied: true }],
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
            settings: [{ providerId: "cf", ttl: 3600, proxied: true }],
            siteIds: ["s1"],
            note: "web",
        });
    });
});

describe("withSetting", () => {
    it("changes one provider and drops it once it is back at the defaults", () => {
        const one = withSetting({}, "cf", { ttl: "300" });
        expect(one).toEqual({ cf: { ttl: "300", proxied: false } });
        expect(withSetting(one, "cf", { proxied: true })).toEqual({ cf: { ttl: "300", proxied: true } });
        expect(withSetting(one, "cf", { ttl: "" })).toEqual({});
    });
});

describe("the record editor's check", () => {
    it("takes a valid draft", () => {
        expect(check({}).isValid).toBe(true);
        expect(check({ settings: { cf: { ttl: "300", proxied: true } } }).isValid).toBe(true);
    });

    it("takes a draft without a site: the record is parked", () => {
        expect(check({ siteIds: [] }).isValid).toBe(true);
    });

    it("says at the field what the server would refuse", () => {
        expect(check({ value: "2001:db8::1" }).errors.value).toMatch(/IPv4/);
        expect(check({ name: "app..example.com" }).errors.name).toMatch(/empty part/);
    });

    it("names a TTL in error at its provider, and holds the save back", () => {
        const settings = { cf: { ttl: "10", proxied: false }, sa: { ttl: "5m", proxied: false }, ok: { ttl: "60", proxied: false } };
        expect(settingErrors({ settings })).toEqual({
            cf: "At least 60 seconds",
            sa: "Whole seconds, or empty for the provider's default",
        });
        expect(check({ settings }).isValid).toBe(false);
    });
});
