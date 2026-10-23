import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/AppConfig.js", () => ({
    appConfig: { secretKey: "test-secret-key", settings: { activity_level_overrides: "" } },
    secretKeyPersisted: () => true,
}));
// Nothing here may talk to a real provider. The readings are what a test puts in.
const readings = vi.hoisted(() => new Map<string, import("../providers/DnsProvider.js").ProviderEntry[]>());
vi.mock("./ProviderReadService.js", () => ({
    ProviderReadService: {
        readSoon: () => undefined,
        forget: (id: string) => readings.delete(id),
        entries: () => readings,
        readings: () => [],
        patch: () => undefined,
    },
}));
vi.mock("../providers/clients.js", () => ({
    clientFor: () => {
        throw new Error("No test here talks to a provider");
    },
}));
vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});

import db from "../core/Database.js";
import { ProviderInputSchema, ProviderListSchema, RecordInputSchema, RecordListSchema, SiteInputSchema, SiteListSchema } from "@dpm/shared";
import { ProviderService } from "./ProviderService.js";
import { RecordService } from "./RecordService.js";
import { SiteService } from "./SiteService.js";
import { RequestError } from "./RequestError.js";
import { decryptSecret } from "./SecretCrypto.js";
import { UnmanagedService } from "./UnmanagedService.js";
import { SyncService } from "./SyncService.js";
import { ProviderZoneRepository } from "../repositories/ProviderZoneRepository.js";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";

const USER = "admin";

beforeEach(() => {
    readings.clear();
    db.exec("DELETE FROM record_links; DELETE FROM record_sites; DELETE FROM records; DELETE FROM site_providers; DELETE FROM sites; DELETE FROM provider_zones; DELETE FROM providers; DELETE FROM activity;");
});

const provider = (over: object = {}) =>
    ProviderService.create(
        ProviderInputSchema.parse({ type: "adguard", name: "AdGuard 1", url: "http://10.0.0.2:3000", username: "admin", secret: "pw", ...over }),
        USER,
    );
const site = (name: string, providerIds: string[] = []) => SiteService.create(SiteInputSchema.parse({ name, providerIds }), USER);
const record = (siteIds: string[], over: object = {}) =>
    RecordService.create(RecordInputSchema.parse({ name: "app.example.com", type: "A", value: "192.168.1.10", siteIds, ...over }), USER);

/**
 * The stored events of one kind. Events written within the same millisecond have no order
 * among themselves, so a test looks for the kind rather than at the top of the list.
 */
const events = (kind: string) => ActivityRepository.list(0).filter((e) => e.kind === kind);

/** The status a service call is refused with, at once or awaited. */
async function refusal(run: () => unknown): Promise<number | undefined> {
    try {
        await run();
    } catch (err) {
        if (err instanceof RequestError) return err.status;
        throw err;
    }
    return undefined;
}

describe("the database", () => {
    it("checks foreign keys", async () => {
        expect(() => db.prepare("INSERT INTO site_providers (site_id, provider_id) VALUES ('x', 'y')").run()).toThrow(/FOREIGN KEY/);
    });
});

describe("SiteService", () => {
    it("keeps the providers of a site and names them in the activity", async () => {
        const ag = provider();
        const internal = site("internal", [ag.id]);
        expect(internal).toMatchObject({ name: "internal", providerIds: [ag.id], recordCount: 0 });
        expect(ProviderRepository.findById(ag.id)?.siteIds).toEqual([internal.id]);
        expect(events("site.created")[0]).toMatchObject({
            source: "user",
            data: { user: USER, name: "internal", providers: ["AdGuard 1"] },
        });
    });

    it("refuses a name another site has, ignoring case, and a provider that does not exist", async () => {
        site("internal");
        expect(await refusal(() => site("Internal"))).toBe(409);
        expect(await refusal(() => site("external", ["nope"]))).toBe(400);
    });

    it("records what a change changed, and nothing for no change", async () => {
        const internal = site("internal");
        SiteService.update(internal.id, SiteInputSchema.parse({ name: "home" }), USER);
        expect(events("site.changed")[0].data).toMatchObject({ changes: [{ field: "name", from: "internal", to: "home" }] });
        const stored = ActivityRepository.count();
        SiteService.update(internal.id, SiteInputSchema.parse({ name: "home" }), USER);
        expect(ActivityRepository.count()).toBe(stored);
    });

    it("takes itself out of its records' sites, and parks a record that had no other", async () => {
        const internal = site("internal");
        const external = site("external");
        const both = await record([internal.id, external.id]);
        const alone = await record([internal.id], { value: "192.168.1.11" });
        SiteService.delete(internal.id, USER);
        expect(SiteRepository.findById(internal.id)).toBeUndefined();
        expect(RecordRepository.findById(both.id)?.siteIds).toEqual([external.id]);
        expect(RecordRepository.findById(alone.id)?.siteIds).toEqual([]);
    });
});

describe("RecordService", () => {
    it("keeps a record without a site, and says so in the activity", async () => {
        const internal = site("internal");
        const parked = await record([]);
        expect(parked).toMatchObject({ siteIds: [], links: [], skipped: [] });
        await RecordService.update(parked.id, RecordInputSchema.parse({ ...parked, siteIds: [internal.id] }), USER);
        await RecordService.update(parked.id, RecordInputSchema.parse({ ...parked, siteIds: [] }), USER);
        expect(events("record.changed")[0].data).toMatchObject({ changes: [{ field: "sites", from: "internal", to: "none" }] });
    });

    it("stores a record with its sites and who made it", async () => {
        const internal = site("internal");
        const created = await record([internal.id]);
        expect(RecordListSchema.safeParse(SyncService.views(RecordRepository.findAll())).success).toBe(true);
        expect(SiteListSchema.safeParse(SiteRepository.findAll()).success).toBe(true);
        expect(created).toMatchObject({ name: "app.example.com", siteIds: [internal.id], createdBy: USER, ttl: null });
        expect(SiteRepository.findById(internal.id)?.recordCount).toBe(1);
        expect(events("record.created")[0]).toMatchObject({
            data: { name: "app.example.com", type: "A", value: "192.168.1.10", sites: ["internal"] },
        });
    });

    it("refuses an unknown site and a conflict", async () => {
        const internal = site("internal");
        expect(await refusal(() => record(["nope"]))).toBe(400);
        await record([internal.id]);
        expect(await refusal(() => record([internal.id]))).toBe(409);
        expect(await refusal(() => record([internal.id], { type: "CNAME", value: "web.example.com" }))).toBe(409);
    });

    it("finds a conflict through a provider two sites share", async () => {
        const ag = provider();
        const internal = site("internal", [ag.id]);
        const lab = site("lab", [ag.id]);
        await record([internal.id]);
        expect(await refusal(() => record([lab.id], { type: "CNAME", value: "web.example.com" }))).toBe(409);
    });

    it("lists the changes and leaves an unchanged record alone", async () => {
        const internal = site("internal");
        const created = await record([internal.id]);
        await RecordService.update(created.id, RecordInputSchema.parse({ ...created, value: "192.168.1.11", ttl: 300 }), "bob");
        expect(RecordRepository.findById(created.id)).toMatchObject({ value: "192.168.1.11", updatedBy: "bob" });
        expect(events("record.changed")[0].data).toMatchObject({
            changes: [
                { field: "value", from: "192.168.1.10", to: "192.168.1.11" },
                { field: "ttl", from: "default", to: "300 s" },
            ],
        });
        const stored = ActivityRepository.count();
        await RecordService.update(created.id, RecordInputSchema.parse({ ...created, value: "192.168.1.11", ttl: 300 }), USER);
        expect(ActivityRepository.count()).toBe(stored);
        expect(RecordRepository.findById(created.id)?.updatedBy).toBe("bob");
    });

    it("answers 404 for a record that is not there", async () => {
        expect(await refusal(() => RecordService.delete("nope", USER))).toBe(404);
    });
});

describe("ProviderService", () => {
    it("reads back what each type was created with", async () => {
        const cf = ProviderService.create(ProviderInputSchema.parse({ type: "cloudflare", name: "CF", secret: "t", zoneMode: "selected" }), USER);
        const samba = ProviderService.create(
            ProviderInputSchema.parse({ type: "samba-ad", name: "Samba", servers: ["dc1", "dc2:636"], username: "dpm@ad", secret: "pw", allowSelfSigned: true }),
            USER,
        );
        expect(ProviderRepository.findById(cf.id)).toMatchObject({ type: "cloudflare", zoneMode: "selected" });
        expect(ProviderRepository.findById(samba.id)).toMatchObject({ servers: ["dc1", "dc2:636"], username: "dpm@ad", allowSelfSigned: true });
        // Every row reads as the browser parses it.
        expect(ProviderListSchema.safeParse(ProviderRepository.findAll()).success).toBe(true);
    });

    it("needs a secret to be created, and stores it encrypted", async () => {
        expect(await refusal(() => provider({ secret: undefined }))).toBe(400);
        const ag = provider({ secret: "s3cret" });
        expect(ag.hasSecret).toBe(true);
        expect(ag).not.toHaveProperty("secret");
        const stored = (db.prepare("SELECT secret FROM providers WHERE id = ?").get(ag.id) as { secret: string }).secret;
        expect(stored).not.toContain("s3cret");
        expect(decryptSecret(stored)).toBe("s3cret");
    });

    it("keeps the secret when an update leaves it out, and says only that it was replaced", async () => {
        const ag = provider({ secret: "first" });
        const read = () => decryptSecret((db.prepare("SELECT secret FROM providers WHERE id = ?").get(ag.id) as { secret: string }).secret);
        ProviderService.update(ag.id, ProviderInputSchema.parse({ ...ag, secret: undefined, name: "AdGuard A" }), USER);
        expect(read()).toBe("first");
        ProviderService.update(ag.id, ProviderInputSchema.parse({ ...ag, name: "AdGuard A", secret: "second" }), USER);
        expect(read()).toBe("second");
        expect(JSON.stringify(ActivityRepository.list(0))).not.toMatch(/first|second/);
        const replaced = events("provider.changed").filter((e) => JSON.stringify(e.data).includes('"field":"secret"'));
        expect(replaced).toHaveLength(1);
        expect(replaced[0].data).toMatchObject({ changes: [{ field: "secret", from: "stored", to: "replaced" }] });
    });

    it("refuses to change the type and a name another provider has", async () => {
        const ag = provider();
        expect(await refusal(() => ProviderService.update(ag.id, ProviderInputSchema.parse({ type: "cloudflare", name: "x" }), USER))).toBe(400);
        expect(await refusal(() => provider({ name: "adguard 1" }))).toBe(409);
    });

    it("leaves every site it was in when it is deleted", async () => {
        const ag = provider();
        const internal = site("internal", [ag.id]);
        ProviderService.delete(ag.id, USER);
        expect(SiteRepository.findById(internal.id)?.providerIds).toEqual([]);
    });
});

describe("UnmanagedService", () => {
    /** A Cloudflare provider that sees example.com, in a site of its own, holding `entries`. */
    function cloudflare(entries: Array<Partial<import("../providers/DnsProvider.js").ProviderEntry>>) {
        const cf = ProviderService.create(ProviderInputSchema.parse({ type: "cloudflare", name: "Cloudflare", secret: "t" }), USER);
        ProviderZoneRepository.replace(cf.id, [{ id: "z1", name: "example.com" }]);
        readings.set(
            cf.id,
            entries.map((e, i) => ({
                externalId: `e${i}`,
                zoneId: "z1",
                zone: "example.com",
                name: "app.example.com",
                type: "A",
                value: "203.0.113.10",
                ttl: null,
                proxied: false,
                disabled: false,
                ...e,
            })),
        );
        return { cf, external: site("external", [cf.id]) };
    }

    it("lists what Cloudflare holds and dpm does not", async () => {
        cloudflare([{}, { name: "www.example.com", type: "CNAME", value: "app.example.com" }]);
        expect(UnmanagedService.list().entries.map((e) => e.name)).toEqual(["app.example.com", "www.example.com"]);
    });

    it("takes entries over into a site of their provider, as one group in the activity", async () => {
        const { cf, external } = cloudflare([{ ttl: 300, proxied: true }, { name: "www.example.com" }]);
        const result = UnmanagedService.adopt(
            external.id,
            [
                { providerId: cf.id, externalId: "e0" },
                { providerId: cf.id, externalId: "e1" },
            ],
            USER,
        );
        expect(result.refused).toEqual([]);
        expect(result.adopted.map((a) => a.name)).toEqual(["app.example.com", "www.example.com"]);
        expect(RecordRepository.findAll().find((r) => r.name === "app.example.com")).toMatchObject({
            ttl: 300,
            proxied: true,
            siteIds: [external.id],
        });
        expect(UnmanagedService.list().entries).toEqual([]);
        const adopted = events("record.adopted");
        expect(adopted).toHaveLength(2);
        const [summary] = events("record.adoption");
        expect(summary.data).toMatchObject({ count: 2, site: "external", providers: ["Cloudflare"] });
        expect(new Set([...adopted, summary].map((e) => e.correlationId)).size).toBe(1);
        expect(adopted[0].data).toMatchObject({ provider: "Cloudflare", merged: false });
    });

    it("gives the record dpm has in other sites the site, instead of a second record", async () => {
        const { cf, external } = cloudflare([{}]);
        const internal = site("internal");
        const existing = await record([internal.id], { value: "203.0.113.10" });
        const result = UnmanagedService.adopt(external.id, [{ providerId: cf.id, externalId: "e0" }], USER);
        expect(result.adopted).toEqual([{ name: "app.example.com", type: "A", value: "203.0.113.10", merged: true }]);
        expect(RecordRepository.findById(existing.id)?.siteIds.sort()).toEqual([external.id, internal.id].sort());
        expect(RecordRepository.findAll()).toHaveLength(1);
    });

    it("refuses a site that does not write to the provider, a name dpm cannot hold and a conflict -- and goes on", async () => {
        const { cf, external } = cloudflare([{}, { name: "bad_name.example.com" }, { type: "CNAME", value: "web.example.com" }]);
        const elsewhere = site("lab");
        expect(UnmanagedService.adopt(elsewhere.id, [{ providerId: cf.id, externalId: "e0" }], USER).refused[0].reason).toBe(
            'The site "lab" does not write to Cloudflare',
        );
        const result = UnmanagedService.adopt(
            external.id,
            ["e0", "e1", "e2", "gone"].map((externalId) => ({ providerId: cf.id, externalId })),
            USER,
        );
        expect(result.adopted.map((a) => a.type)).toEqual(["A"]);
        expect(result.refused.map((r) => r.reason)).toEqual([
            expect.stringMatching(/only letters, digits and hyphens/),
            expect.stringMatching(/a CNAME cannot stand beside another record/),
            "Not among the unmanaged entries any more; read the provider again",
        ]);
    });

    it("refuses a site that does not exist", async () => {
        expect(await refusal(() => UnmanagedService.adopt("nope", [{ providerId: "p", externalId: "e" }], USER))).toBe(400);
    });
});

describe("zones", () => {
    const cloudflareProvider = (name: string, over: object = {}) =>
        ProviderService.create(ProviderInputSchema.parse({ type: "cloudflare", name, secret: "t", ...over }), USER);

    it("are used by the provider created first, until another one ticks them", async () => {
        const first = cloudflareProvider("First");
        const second = cloudflareProvider("Second", { zoneMode: "selected" });
        ProviderZoneRepository.replace(first.id, [{ id: "z1", name: "example.com" }]);
        ProviderZoneRepository.replace(second.id, [{ id: "z1", name: "example.com" }]);
        expect(ProviderRepository.findById(first.id)?.zones[0].owner).toBe(first.id);

        ProviderService.update(second.id, ProviderInputSchema.parse({ ...ProviderRepository.findById(second.id), zoneIds: ["z1"] }), USER);
        expect(ProviderRepository.findById(first.id)?.zones[0].owner).toBe(second.id);
        expect(ProviderRepository.findById(second.id)).toMatchObject({ zoneIds: ["z1"] });
    });

    it("refuse a zone another provider has ticked already", async () => {
        const a = cloudflareProvider("A", { zoneMode: "selected" });
        const b = cloudflareProvider("B", { zoneMode: "selected" });
        for (const p of [a, b]) ProviderZoneRepository.replace(p.id, [{ id: "z1", name: "example.com" }]);
        ProviderService.update(a.id, ProviderInputSchema.parse({ ...ProviderRepository.findById(a.id), zoneIds: ["z1"] }), USER);
        expect(
            await refusal(() => ProviderService.update(b.id, ProviderInputSchema.parse({ ...ProviderRepository.findById(b.id), zoneIds: ["z1"] }), USER)),
        ).toBe(409);
    });

    it("keep their tick across a reading, and lose it when they are gone", async () => {
        const a = cloudflareProvider("A", { zoneMode: "selected" });
        ProviderZoneRepository.replace(a.id, [{ id: "z1", name: "example.com" }, { id: "z2", name: "example.net" }]);
        ProviderZoneRepository.setSelected(a.id, ["z1", "z2"]);
        ProviderZoneRepository.replace(a.id, [{ id: "z1", name: "example.com" }, { id: "z3", name: "example.org" }]);
        expect(ProviderRepository.findById(a.id)?.zones.map((z) => [z.id, z.selected])).toEqual([
            ["z1", true],
            ["z3", false],
        ]);
    });
});
