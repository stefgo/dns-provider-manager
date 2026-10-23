import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderEntry, ProviderZoneInfo, RecordData, EntryRef } from "../providers/DnsProvider.js";

vi.mock("../config/AppConfig.js", () => ({
    appConfig: { secretKey: "test-secret-key", settings: { activity_level_overrides: "" } },
    secretKeyPersisted: () => true,
}));
vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});

/**
 * Stand-ins for the DNS servers: what each provider holds (`held`), which ones are down, and
 * every call made to them. dpm's last reading of a provider is `readings`, filled by `read`.
 */
const world = vi.hoisted(() => ({
    held: new Map<string, ProviderEntry[]>(),
    down: new Set<string>(),
    calls: [] as string[],
    readings: new Map<string, ProviderEntry[]>(),
    next: 0,
}));

vi.mock("./ProviderReadService.js", () => ({
    ProviderReadService: {
        readSoon: () => undefined,
        forget: (id: string) => world.readings.delete(id),
        entries: () => world.readings,
        readings: () => [],
        patch: (id: string, change: { remove?: string; add?: ProviderEntry }) => {
            const entries = world.readings.get(id);
            if (!entries) return;
            const kept = entries.filter((e) => e.externalId !== change.remove && e.externalId !== change.add?.externalId);
            world.readings.set(id, change.add ? [...kept, change.add] : kept);
        },
    },
}));

vi.mock("../providers/clients.js", () => ({
    clientFor: (provider: { id: string; name: string; type: string }) => {
        const list = () => world.held.get(provider.id) ?? [];
        const refuse = (what: string) => {
            world.calls.push(`${provider.name} ${what}`);
            if (world.down.has(provider.id)) throw new Error(`${provider.name} is down`);
        };
        const entryOf = (zone: ProviderZoneInfo | null, record: RecordData): ProviderEntry => ({
            externalId: `${provider.id}-${++world.next}`,
            zoneId: zone?.id ?? null,
            zone: zone?.name ?? null,
            ...record,
            ttl: provider.type === "adguard" ? null : record.ttl,
            disabled: false,
        });
        return {
            zoned: provider.type !== "adguard",
            test: async () => "",
            listZones: async () => [],
            listRecords: async () => list(),
            create: async (zone: ProviderZoneInfo | null, record: RecordData) => {
                refuse(`create ${record.name} ${record.value}`);
                const entry = entryOf(zone, record);
                world.held.set(provider.id, [...list(), entry]);
                return entry;
            },
            update: async (target: EntryRef, record: RecordData) => {
                refuse(`update ${record.name} ${record.value}`);
                const entry = entryOf(target.zoneId ? { id: target.zoneId, name: target.zone ?? "" } : null, record);
                world.held.set(provider.id, [...list().filter((e) => e.externalId !== target.externalId), entry]);
                return entry;
            },
            delete: async (target: EntryRef) => {
                refuse(`delete ${list().find((e) => e.externalId === target.externalId)?.value ?? "gone"}`);
                world.held.set(provider.id, list().filter((e) => e.externalId !== target.externalId));
            },
            close: async () => undefined,
        };
    },
}));

import db from "../core/Database.js";
import { ProviderInputSchema, RecordInputSchema, SiteInputSchema, type DnsRecord } from "@dpm/shared";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { ProviderZoneRepository } from "../repositories/ProviderZoneRepository.js";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { ProviderService } from "./ProviderService.js";
import { RecordService } from "./RecordService.js";
import { RequestError } from "./RequestError.js";
import { SiteService } from "./SiteService.js";
import { SyncService } from "./SyncService.js";

const USER = "admin";

beforeEach(() => {
    world.held.clear();
    world.down.clear();
    world.readings.clear();
    world.calls.length = 0;
    db.exec(
        "DELETE FROM record_links; DELETE FROM record_sites; DELETE FROM records; DELETE FROM site_providers; DELETE FROM sites; DELETE FROM provider_zones; DELETE FROM providers; DELETE FROM activity;",
    );
});

const adguard = (name: string, over: object = {}) =>
    ProviderService.create(ProviderInputSchema.parse({ type: "adguard", name, url: "http://10.0.0.2:3000", username: "admin", secret: "pw", ...over }), USER);

function cloudflare(name: string) {
    const provider = ProviderService.create(ProviderInputSchema.parse({ type: "cloudflare", name, secret: "t" }), USER);
    ProviderZoneRepository.replace(provider.id, [{ id: "z1", name: "example.com" }]);
    return provider;
}

/** What a reading of the provider does: dpm learns what it holds, and compares. */
async function read(providerId: string) {
    world.readings.set(providerId, [...(world.held.get(providerId) ?? [])]);
    await SyncService.afterReading(providerId);
}

const site = (name: string, providerIds: string[]) => SiteService.create(SiteInputSchema.parse({ name, providerIds }), USER);
const fields = (siteIds: string[], over: object = {}) =>
    RecordInputSchema.parse({ name: "app.example.com", type: "A", value: "192.168.1.10", siteIds, ...over });
/** An entry a provider holds by itself, as dpm would write `app.example.com A 192.168.1.10`. */
const held = (externalId: string): ProviderEntry => ({
    externalId,
    zoneId: null,
    zone: null,
    name: "app.example.com",
    type: "A",
    value: "192.168.1.10",
    ttl: null,
    proxied: false,
    disabled: false,
});
const statuses = (record: DnsRecord | undefined) => Object.fromEntries((record?.links ?? []).map((l) => [l.providerId, l.status]));
const values = (providerId: string) => (world.held.get(providerId) ?? []).map((e) => e.value);
const kinds = () => ActivityRepository.list(0).map((e) => e.kind);

describe("writing a record", () => {
    it("goes to every provider of its sites, and takes over an entry that is there already", async () => {
        const ag1 = adguard("AdGuard 1");
        const ag2 = adguard("AdGuard 2");
        const internal = site("internal", [ag1.id, ag2.id]);
        world.held.set(ag2.id, [held("x")]);
        await read(ag1.id);
        await read(ag2.id);

        const record = await RecordService.create(fields([internal.id]), USER);
        expect(statuses(record)).toEqual({ [ag1.id]: "in_sync", [ag2.id]: "in_sync" });
        expect(world.calls).toEqual(["AdGuard 1 create app.example.com 192.168.1.10"]);
        expect(values(ag2.id)).toEqual(["192.168.1.10"]);
        expect(kinds()).toContain("record.written");
    });

    it("writes a change, and only where the provider knows the field", async () => {
        const ag = adguard("AdGuard");
        const internal = site("internal", [ag.id]);
        await read(ag.id);
        const record = await RecordService.create(fields([internal.id]), USER);
        world.calls.length = 0;
        await RecordService.update(record.id, fields([internal.id], { ttl: 600 }), USER);
        expect(world.calls).toEqual([]);
        await RecordService.update(record.id, fields([internal.id], { value: "192.168.1.11" }), USER);
        expect(world.calls).toEqual(["AdGuard update app.example.com 192.168.1.11"]);
        expect(values(ag.id)).toEqual(["192.168.1.11"]);
    });

    it("keeps the record when a provider fails, and writes it after that provider's next reading", async () => {
        const ag = adguard("AdGuard");
        const internal = site("internal", [ag.id]);
        await read(ag.id);
        world.down.add(ag.id);
        const record = await RecordService.create(fields([internal.id]), USER);
        expect(record.links[0]).toMatchObject({ status: "error", error: "AdGuard is down" });
        expect(kinds()).toContain("record.write_failed");

        world.down.delete(ag.id);
        await read(ag.id);
        expect(statuses(SyncService.view(record.id))).toEqual({ [ag.id]: "in_sync" });
        expect(values(ag.id)).toEqual(["192.168.1.10"]);
    });

    it("writes nothing to a provider that is read only, or was never read", async () => {
        const locked = adguard("Locked", { readOnly: true });
        const unread = adguard("Unread");
        const internal = site("internal", [locked.id, unread.id]);
        await read(locked.id);
        const record = await RecordService.create(fields([internal.id]), USER);
        expect(world.calls).toEqual([]);
        expect(record.links.map((l) => [l.status, l.error])).toEqual(
            expect.arrayContaining([
                ["pending", "Read only"],
                ["pending", "Not read yet: written once dpm knows what it holds"],
            ]),
        );
    });

    it("refuses a CNAME beside an entry the provider holds and dpm does not manage", async () => {
        const ag = adguard("AdGuard");
        const internal = site("internal", [ag.id]);
        world.held.set(ag.id, [held("x")]);
        await read(ag.id);
        await expect(RecordService.create(fields([internal.id], { type: "CNAME", value: "web.example.com" }), USER)).rejects.toThrow(
            RequestError,
        );
        expect(RecordRepository.findAll()).toEqual([]);
    });
});

describe("moving and deleting", () => {
    it("deletes at Cloudflare only once the AdGuard Home instances hold the record", async () => {
        const cf = cloudflare("Cloudflare");
        const ag = adguard("AdGuard");
        const external = site("external", [cf.id]);
        const internal = site("internal", [ag.id]);
        await read(cf.id);
        await read(ag.id);
        const record = await RecordService.create(fields([external.id]), USER);
        expect(values(cf.id)).toEqual(["192.168.1.10"]);

        world.down.add(ag.id);
        const moved = await RecordService.update(record.id, fields([internal.id]), USER);
        expect(values(cf.id)).toEqual(["192.168.1.10"]);
        expect(moved.links.find((l) => l.providerId === cf.id)).toMatchObject({ status: "removing", error: "Waits until the record is in place at AdGuard" });

        world.down.delete(ag.id);
        await read(ag.id);
        expect(values(ag.id)).toEqual(["192.168.1.10"]);
        // Cloudflare's turn comes with its own reading.
        await read(cf.id);
        expect(values(cf.id)).toEqual([]);
        expect(statuses(SyncService.view(record.id))).toEqual({ [ag.id]: "in_sync" });
    });

    it("removes a deleted record everywhere, and keeps trying where that fails", async () => {
        const ag1 = adguard("AdGuard 1");
        const ag2 = adguard("AdGuard 2");
        const internal = site("internal", [ag1.id, ag2.id]);
        await read(ag1.id);
        await read(ag2.id);
        const record = await RecordService.create(fields([internal.id]), USER);
        world.down.add(ag2.id);
        await RecordService.delete(record.id, USER);
        expect(values(ag1.id)).toEqual([]);
        expect(SyncService.removals()).toEqual([
            { providerId: ag2.id, name: "app.example.com", type: "A", value: "192.168.1.10", error: "AdGuard 2 is down" },
        ]);
        world.down.delete(ag2.id);
        await read(ag2.id);
        expect(values(ag2.id)).toEqual([]);
        expect(SyncService.removals()).toEqual([]);
    });

    it("removes a parked record from every provider and keeps it, and writes it again with a site", async () => {
        const ag1 = adguard("AdGuard 1");
        const ag2 = adguard("AdGuard 2");
        const internal = site("internal", [ag1.id, ag2.id]);
        await read(ag1.id);
        await read(ag2.id);
        const record = await RecordService.create(fields([internal.id]), USER);
        world.calls.length = 0;
        const parked = await RecordService.update(record.id, fields([]), USER);
        expect(world.calls.sort()).toEqual(["AdGuard 1 delete 192.168.1.10", "AdGuard 2 delete 192.168.1.10"]);
        expect(parked.links).toEqual([]);
        expect(RecordRepository.findById(record.id)).toBeDefined();
        expect(SyncService.removals()).toEqual([]);

        await RecordService.update(record.id, fields([internal.id]), USER);
        expect(values(ag1.id)).toEqual(["192.168.1.10"]);
        expect(values(ag2.id)).toEqual(["192.168.1.10"]);
    });

    it("parks the records a deleted site alone had, and removes them from its providers", async () => {
        const ag = adguard("AdGuard");
        const internal = site("internal", [ag.id]);
        await read(ag.id);
        const record = await RecordService.create(fields([internal.id]), USER);
        SiteService.delete(internal.id, USER);
        await vi.waitFor(() => expect(values(ag.id)).toEqual([]));
        expect(RecordRepository.findById(record.id)?.siteIds).toEqual([]);
    });

    it("writes a site's records to a provider that joins it, and removes them from one that leaves", async () => {
        const ag1 = adguard("AdGuard 1");
        const ag2 = adguard("AdGuard 2");
        const internal = site("internal", [ag1.id]);
        await read(ag1.id);
        await read(ag2.id);
        await RecordService.create(fields([internal.id]), USER);
        const change = SiteInputSchema.parse({ name: "internal", providerIds: [ag2.id] });
        expect(SyncService.previewSite(internal.id, change)).toEqual([
            { providerId: ag2.id, create: 1, delete: 0 },
            { providerId: ag1.id, create: 0, delete: 1 },
        ]);
        SiteService.update(internal.id, change, USER);
        await vi.waitFor(() => expect(values(ag1.id)).toEqual([]));
        expect(values(ag2.id)).toEqual(["192.168.1.10"]);
    });
});

describe("drift", () => {
    async function written() {
        const ag1 = adguard("AdGuard 1");
        const ag2 = adguard("AdGuard 2");
        const internal = site("internal", [ag1.id, ag2.id]);
        await read(ag1.id);
        await read(ag2.id);
        const record = await RecordService.create(fields([internal.id]), USER);
        return { ag1, ag2, internal, record };
    }

    /** Someone changes the answer in AdGuard Home's own interface. */
    function changeAt(providerId: string, value: string) {
        const [entry] = world.held.get(providerId)!;
        world.held.set(providerId, [{ ...entry, externalId: `${entry.externalId}-changed`, value }]);
    }

    it("is found by a reading and left alone, and written over on request", async () => {
        const { ag1, record } = await written();
        changeAt(ag1.id, "192.168.1.99");
        world.calls.length = 0;
        await read(ag1.id);
        expect(world.calls).toEqual([]);
        expect(SyncService.view(record.id)?.links.find((l) => l.providerId === ag1.id)).toMatchObject({
            status: "drift",
            observed: { value: "192.168.1.99" },
        });
        expect(kinds()).toContain("record.drift");

        await RecordService.rewrite(record.id, ag1.id, USER);
        expect(world.calls).toEqual(["AdGuard 1 update app.example.com 192.168.1.10"]);
        expect(values(ag1.id)).toEqual(["192.168.1.10"]);
        expect(kinds()).toContain("record.corrected");
    });

    it("takes over a changed value for every provider of the record", async () => {
        const { ag1, ag2, record } = await written();
        changeAt(ag1.id, "192.168.1.99");
        await read(ag1.id);
        world.calls.length = 0;
        const accepted = await RecordService.accept(record.id, ag1.id, USER);
        expect(accepted.value).toBe("192.168.1.99");
        expect(world.calls).toEqual(["AdGuard 2 update app.example.com 192.168.1.99"]);
        expect(statuses(accepted)).toEqual({ [ag1.id]: "in_sync", [ag2.id]: "in_sync" });
    });

    it("takes over a deletion by leaving the site, without touching the provider", async () => {
        const { ag1, ag2, internal, record } = await written();
        const lab = site("lab", [ag2.id]);
        await RecordService.update(record.id, fields([internal.id, lab.id]), USER);
        world.held.set(ag1.id, []);
        await read(ag1.id);
        expect(statuses(SyncService.view(record.id))[ag1.id]).toBe("missing");

        world.calls.length = 0;
        const accepted = await RecordService.accept(record.id, ag1.id, USER);
        expect(accepted.siteIds).toEqual([lab.id]);
        expect(world.calls).toEqual([]);
        expect(statuses(accepted)).toEqual({ [ag2.id]: "in_sync" });
    });

    it("parks the record when taking over a deletion leaves it without a site", async () => {
        const { ag1, record } = await written();
        world.held.set(ag1.id, []);
        await read(ag1.id);
        world.calls.length = 0;
        const accepted = await RecordService.accept(record.id, ag1.id, USER);
        expect(accepted.siteIds).toEqual([]);
        expect(RecordRepository.findById(record.id)).toBeDefined();
        expect(world.calls).toEqual(["AdGuard 2 delete 192.168.1.10"]);
        expect(accepted.links).toEqual([]);
        expect(statuses(SyncService.view(record.id))).toEqual({});
    });

    it("is written over by itself where the provider says so", async () => {
        const { ag1 } = await written();
        ProviderService.update(ag1.id, ProviderInputSchema.parse({ ...ag1, autoCorrect: true }), USER);
        world.held.set(ag1.id, []);
        await read(ag1.id);
        expect(values(ag1.id)).toEqual(["192.168.1.10"]);
        expect(ActivityRepository.list(0).find((e) => e.kind === "record.corrected")?.data).toMatchObject({ auto: true });
    });
});
