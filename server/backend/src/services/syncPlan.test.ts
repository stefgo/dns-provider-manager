import { describe, expect, it } from "vitest";
import type { ProviderEntry, RecordData } from "../providers/DnsProvider.js";
import type { RecordLink } from "../repositories/RecordLinkRepository.js";
import { claimKey, planRecord, sameAtProvider, type PlanContext, type PlanProvider } from "./syncPlan.js";

const ag = (id: string, over: Partial<PlanProvider> = {}): PlanProvider => ({ id, name: id, type: "adguard", readOnly: false, writable: true, ...over });
const cf = (id: string, over: Partial<PlanProvider> = {}): PlanProvider => ({ id, name: id, type: "cloudflare", readOnly: false, writable: true, ...over });

const ZONE = { id: "z1", name: "example.com" };
const RECORD: RecordData = { name: "app.example.com", type: "A", value: "192.168.1.10", ttl: null, proxied: false };

const entry = (over: Partial<ProviderEntry> = {}): ProviderEntry => ({
    externalId: "e1",
    zoneId: null,
    zone: null,
    ...RECORD,
    disabled: false,
    ...over,
});

const link = (providerId: string, over: Partial<RecordLink> = {}): RecordLink => ({
    recordId: "r1",
    providerId,
    zoneId: null,
    externalId: "e1",
    written: RECORD,
    status: "in_sync",
    error: null,
    observed: null,
    attempts: 0,
    lastAttemptAt: null,
    syncedAt: null,
    ...over,
});

function context(providers: PlanProvider[], readings: Record<string, ProviderEntry[]>, claimed: string[] = []): PlanContext {
    return {
        providers: new Map(providers.map((p) => [p.id, p])),
        readings: new Map(Object.entries(readings)),
        claimed: new Set(claimed),
    };
}

describe("sameAtProvider", () => {
    it("compares only what the provider knows, and no TTL while Cloudflare proxies", () => {
        const caps = { zoned: true, ttl: true, proxied: true };
        expect(sameAtProvider(RECORD, { ...RECORD, ttl: 300 }, { zoned: false, ttl: false, proxied: false })).toBe(true);
        expect(sameAtProvider(RECORD, { ...RECORD, ttl: 300 }, caps)).toBe(false);
        expect(sameAtProvider({ ...RECORD, proxied: true, ttl: 300 }, { ...RECORD, proxied: true, ttl: null }, caps)).toBe(true);
        expect(sameAtProvider(RECORD, { ...RECORD, proxied: true }, caps)).toBe(false);
    });
});

describe("planRecord", () => {
    it("creates where the provider holds nothing, and takes over an entry that is there already", () => {
        const ctx = context([ag("a"), ag("b")], { a: [], b: [entry({ externalId: "x" })] });
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }, { providerId: "b", zone: null }], [], ctx)).toEqual([
            { kind: "create", providerId: "a", zone: null },
            { kind: "adopt", providerId: "b", entry: entry({ externalId: "x" }) },
        ]);
    });

    it("does not take over an entry another record holds, or one that is switched off", () => {
        const ctx = context([ag("a")], { a: [entry({ externalId: "x" }), entry({ externalId: "y", disabled: true })] }, [claimKey("a", "x")]);
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }], [], ctx)).toEqual([{ kind: "create", providerId: "a", zone: null }]);
    });

    it("takes over an entry with another TTL by writing over it", () => {
        const ctx = context([cf("c")], { c: [entry({ externalId: "r9", zoneId: "z1", zone: "example.com", ttl: 300 })] });
        expect(planRecord(RECORD, [{ providerId: "c", zone: ZONE }], [], ctx)).toEqual([
            { kind: "update", providerId: "c", target: { externalId: "r9", zoneId: "z1", zone: "example.com" } },
        ]);
    });

    it("writes nothing for a provider that was never read and holds no entry of the record yet", () => {
        const ctx = context([ag("a")], {});
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }], [], ctx)[0]).toMatchObject({ kind: "blocked", removing: false });
    });

    it("updates what changed in dpm, and only in what the provider knows", () => {
        const ctx = context([ag("a")], { a: [entry()] });
        const changed = { ...RECORD, value: "192.168.1.11" };
        expect(planRecord(changed, [{ providerId: "a", zone: null }], [link("a")], ctx)).toEqual([
            { kind: "update", providerId: "a", target: { externalId: "e1", zoneId: null, zone: null } },
        ]);
        expect(planRecord({ ...RECORD, ttl: 600 }, [{ providerId: "a", zone: null }], [link("a")], ctx)).toEqual([
            { kind: "keep", providerId: "a", status: "in_sync", observed: null },
        ]);
    });

    it("writes a changed record anew where its entry is gone", () => {
        const ctx = context([ag("a")], { a: [] });
        expect(planRecord({ ...RECORD, value: "192.168.1.11" }, [{ providerId: "a", zone: null }], [link("a")], ctx)).toEqual([
            { kind: "create", providerId: "a", zone: null },
        ]);
    });

    it("writes a change over what a drifted AdGuard Home rewrite became, not beside it", () => {
        const ctx = context([ag("a")], { a: [entry({ externalId: "e2", value: "192.168.1.99" })] });
        expect(planRecord({ ...RECORD, value: "192.168.1.11" }, [{ providerId: "a", zone: null }], [link("a")], ctx)).toEqual([
            { kind: "update", providerId: "a", target: { externalId: "e2", zoneId: null, zone: null } },
        ]);
    });

    it("moves a record whose name went to another zone of the same provider", () => {
        const ctx = context([cf("c")], { c: [entry({ zoneId: "z0", zone: "example.net" })] });
        expect(planRecord(RECORD, [{ providerId: "c", zone: ZONE }], [link("c", { zoneId: "z0" })], ctx)).toEqual([
            { kind: "replace", providerId: "c", target: { externalId: "e1", zoneId: "z0", zone: null }, zone: ZONE },
        ]);
    });

    it("reports drift and leaves it alone, unless asked to write over it", () => {
        const ctx = context([ag("a")], { a: [entry({ disabled: true })] });
        const drifted = planRecord(RECORD, [{ providerId: "a", zone: null }], [link("a")], ctx);
        expect(drifted).toEqual([{ kind: "keep", providerId: "a", status: "drift", observed: expect.objectContaining({ disabled: true }) }]);
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }], [link("a")], ctx, new Set(["a"]))).toEqual([
            { kind: "update", providerId: "a", target: { externalId: "e1", zoneId: null, zone: null }, correcting: true },
        ]);
    });

    it("tells a changed AdGuard Home answer from a deleted rewrite", () => {
        const changed = context([ag("a")], { a: [entry({ externalId: "e2", value: "192.168.1.99" })] });
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }], [link("a")], changed)[0]).toMatchObject({
            kind: "keep",
            status: "drift",
            observed: { externalId: "e2", value: "192.168.1.99" },
        });
        const gone = context([ag("a")], { a: [] });
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }], [link("a")], gone)).toEqual([
            { kind: "keep", providerId: "a", status: "missing", observed: null },
        ]);
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }], [link("a")], gone, new Set(["a"]))).toEqual([
            { kind: "create", providerId: "a", zone: null, correcting: true },
        ]);
        // Written over, the changed rewrite is the one to change back.
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }], [link("a")], changed, new Set(["a"]))).toEqual([
            { kind: "update", providerId: "a", target: { externalId: "e2", zoneId: null, zone: null }, correcting: true },
        ]);
    });

    it("refuses a CNAME beside an entry no record holds", () => {
        const cname: RecordData = { ...RECORD, type: "CNAME", value: "host.example.com" };
        const ctx = context([ag("a")], { a: [entry({ externalId: "x" })] });
        expect(planRecord(cname, [{ providerId: "a", zone: null }], [], ctx)).toEqual([
            {
                kind: "conflict",
                providerId: "a",
                reason: "a holds an A record for app.example.com that dpm does not manage, and a CNAME cannot stand beside another record of its name. Adopt it or remove it there first.",
            },
        ]);
        // Another record holds it: recordConflict decided that before.
        const held = context([ag("a")], { a: [entry({ externalId: "x" })] }, [claimKey("a", "x")]);
        expect(planRecord(cname, [{ providerId: "a", zone: null }], [], held)[0].kind).toBe("create");
    });

    it("removes from a provider the record no longer goes to, and drops what was never written", () => {
        const ctx = context([ag("a"), ag("b"), ag("c")], { a: [entry()], b: [], c: [] });
        const steps = planRecord(RECORD, [{ providerId: "b", zone: null }], [link("a"), link("b", { externalId: null, written: null }), link("c", { externalId: null })], ctx);
        expect(steps).toEqual([
            { kind: "create", providerId: "b", zone: null },
            { kind: "delete", providerId: "a", target: { externalId: "e1", zoneId: null, zone: null } },
            { kind: "forget", providerId: "c" },
        ]);
    });

    it("removes everywhere for a deleted record, and holds back where it must not write", () => {
        const ctx = context([ag("a"), ag("b", { readOnly: true, writable: false })], { a: [entry()], b: [entry()] });
        expect(planRecord(null, [{ providerId: "a", zone: null }], [link("a"), link("b")], ctx)).toEqual([
            { kind: "delete", providerId: "a", target: { externalId: "e1", zoneId: null, zone: null } },
            { kind: "blocked", providerId: "b", reason: "Read only", removing: true },
        ]);
    });

    it("drops rather than deletes an entry another provider of the record holds: one zone, two tokens", () => {
        const shared = entry({ externalId: "r1", zoneId: "z1", zone: "example.com" });
        const ctx = context([cf("old"), cf("new")], { old: [shared], new: [shared] });
        const steps = planRecord(RECORD, [{ providerId: "new", zone: ZONE }], [link("old", { externalId: "r1", zoneId: "z1" })], ctx);
        expect(steps).toEqual([
            { kind: "adopt", providerId: "new", entry: shared },
            { kind: "forget", providerId: "old" },
        ]);
    });

    it("holds back writes to a provider that is read only or of a type dpm does not write yet", () => {
        const ctx = context([ag("a", { readOnly: true, writable: false }), { id: "s", name: "s", type: "samba-ad", readOnly: false, writable: false }], { a: [], s: [] });
        expect(planRecord(RECORD, [{ providerId: "a", zone: null }, { providerId: "s", zone: ZONE }], [], ctx)).toEqual([
            { kind: "blocked", providerId: "a", reason: "Read only", removing: false },
            { kind: "blocked", providerId: "s", reason: "Writing to Samba AD comes with a later version", removing: false },
        ]);
    });
});
