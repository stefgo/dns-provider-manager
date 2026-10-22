import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/AppConfig.js", () => ({
    appConfig: { secretKey: "test-secret-key", settings: { activity_level_overrides: "" } },
    secretKeyPersisted: () => true,
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
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";

const USER = "admin";

beforeEach(() => {
    db.exec("DELETE FROM record_sites; DELETE FROM records; DELETE FROM site_providers; DELETE FROM sites; DELETE FROM providers; DELETE FROM activity;");
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

/** The status a service call is refused with. */
function refusal(run: () => unknown): number | undefined {
    try {
        run();
    } catch (err) {
        if (err instanceof RequestError) return err.status;
        throw err;
    }
    return undefined;
}

describe("the database", () => {
    it("checks foreign keys", () => {
        expect(() => db.prepare("INSERT INTO site_providers (site_id, provider_id) VALUES ('x', 'y')").run()).toThrow(/FOREIGN KEY/);
    });
});

describe("SiteService", () => {
    it("keeps the providers of a site and names them in the activity", () => {
        const ag = provider();
        const internal = site("internal", [ag.id]);
        expect(internal).toMatchObject({ name: "internal", providerIds: [ag.id], recordCount: 0 });
        expect(ProviderRepository.findById(ag.id)?.siteIds).toEqual([internal.id]);
        expect(events("site.created")[0]).toMatchObject({
            source: "user",
            data: { user: USER, name: "internal", providers: ["AdGuard 1"] },
        });
    });

    it("refuses a name another site has, ignoring case, and a provider that does not exist", () => {
        site("internal");
        expect(refusal(() => site("Internal"))).toBe(409);
        expect(refusal(() => site("external", ["nope"]))).toBe(400);
    });

    it("records what a change changed, and nothing for no change", () => {
        const internal = site("internal");
        SiteService.update(internal.id, SiteInputSchema.parse({ name: "home" }), USER);
        expect(events("site.changed")[0].data).toMatchObject({ changes: [{ field: "name", from: "internal", to: "home" }] });
        const stored = ActivityRepository.count();
        SiteService.update(internal.id, SiteInputSchema.parse({ name: "home" }), USER);
        expect(ActivityRepository.count()).toBe(stored);
    });

    it("refuses to delete the only site of a record, and takes itself out of the others' sites", () => {
        const internal = site("internal");
        const external = site("external");
        const alone = record([internal.id]);
        expect(refusal(() => SiteService.delete(internal.id, USER))).toBe(409);

        RecordService.update(alone.id, RecordInputSchema.parse({ ...alone, siteIds: [internal.id, external.id] }), USER);
        SiteService.delete(internal.id, USER);
        expect(SiteRepository.findById(internal.id)).toBeUndefined();
        expect(RecordRepository.findById(alone.id)?.siteIds).toEqual([external.id]);
    });
});

describe("RecordService", () => {
    it("stores a record with its sites and who made it", () => {
        const internal = site("internal");
        const created = record([internal.id]);
        expect(RecordListSchema.safeParse(RecordRepository.findAll()).success).toBe(true);
        expect(SiteListSchema.safeParse(SiteRepository.findAll()).success).toBe(true);
        expect(created).toMatchObject({ name: "app.example.com", siteIds: [internal.id], createdBy: USER, ttl: null });
        expect(SiteRepository.findById(internal.id)?.recordCount).toBe(1);
        expect(events("record.created")[0]).toMatchObject({
            data: { name: "app.example.com", type: "A", value: "192.168.1.10", sites: ["internal"] },
        });
    });

    it("refuses an unknown site and a conflict", () => {
        const internal = site("internal");
        expect(refusal(() => record(["nope"]))).toBe(400);
        record([internal.id]);
        expect(refusal(() => record([internal.id]))).toBe(409);
        expect(refusal(() => record([internal.id], { type: "CNAME", value: "web.example.com" }))).toBe(409);
    });

    it("finds a conflict through a provider two sites share", () => {
        const ag = provider();
        const internal = site("internal", [ag.id]);
        const lab = site("lab", [ag.id]);
        record([internal.id]);
        expect(refusal(() => record([lab.id], { type: "CNAME", value: "web.example.com" }))).toBe(409);
    });

    it("lists the changes and leaves an unchanged record alone", () => {
        const internal = site("internal");
        const created = record([internal.id]);
        RecordService.update(created.id, RecordInputSchema.parse({ ...created, value: "192.168.1.11", ttl: 300 }), "bob");
        expect(RecordRepository.findById(created.id)).toMatchObject({ value: "192.168.1.11", updatedBy: "bob" });
        expect(events("record.changed")[0].data).toMatchObject({
            changes: [
                { field: "value", from: "192.168.1.10", to: "192.168.1.11" },
                { field: "ttl", from: "default", to: "300 s" },
            ],
        });
        const stored = ActivityRepository.count();
        RecordService.update(created.id, RecordInputSchema.parse({ ...created, value: "192.168.1.11", ttl: 300 }), USER);
        expect(ActivityRepository.count()).toBe(stored);
        expect(RecordRepository.findById(created.id)?.updatedBy).toBe("bob");
    });

    it("answers 404 for a record that is not there", () => {
        expect(refusal(() => RecordService.delete("nope", USER))).toBe(404);
    });
});

describe("ProviderService", () => {
    it("reads back what each type was created with", () => {
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

    it("needs a secret to be created, and stores it encrypted", () => {
        expect(refusal(() => provider({ secret: undefined }))).toBe(400);
        const ag = provider({ secret: "s3cret" });
        expect(ag.hasSecret).toBe(true);
        expect(ag).not.toHaveProperty("secret");
        const stored = (db.prepare("SELECT secret FROM providers WHERE id = ?").get(ag.id) as { secret: string }).secret;
        expect(stored).not.toContain("s3cret");
        expect(decryptSecret(stored)).toBe("s3cret");
    });

    it("keeps the secret when an update leaves it out, and says only that it was replaced", () => {
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

    it("refuses to change the type and a name another provider has", () => {
        const ag = provider();
        expect(refusal(() => ProviderService.update(ag.id, ProviderInputSchema.parse({ type: "cloudflare", name: "x" }), USER))).toBe(400);
        expect(refusal(() => provider({ name: "adguard 1" }))).toBe(409);
    });

    it("leaves every site it was in when it is deleted", () => {
        const ag = provider();
        const internal = site("internal", [ag.id]);
        ProviderService.delete(ag.id, USER);
        expect(SiteRepository.findById(internal.id)?.providerIds).toEqual([]);
    });
});
