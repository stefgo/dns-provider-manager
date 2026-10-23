import { randomUUID } from "crypto";
import type { Site, SiteFields } from "@dpm/shared";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ActivityService } from "./ActivityService.js";
import { RequestError } from "./RequestError.js";
import { SyncService } from "./SyncService.js";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { fieldChanges, nameList } from "./changes.js";

/** The provider names of a list of ids, for an event; an id nobody knows stays an id. */
function providerNames(ids: readonly string[]): string[] {
    const providers = ProviderRepository.findAll();
    return ids.map((id) => providers.find((p) => p.id === id)?.name ?? id);
}

function describe(site: Pick<Site, "name" | "description" | "providerIds">): Record<string, string> {
    return {
        name: site.name,
        description: site.description || "–",
        providers: nameList(providerNames(site.providerIds)),
    };
}

/** Refuses a name another site has, and providers that do not exist. */
function check(fields: SiteFields, exceptId?: string): void {
    if (SiteRepository.nameTaken(fields.name, exceptId)) {
        throw new RequestError(409, `A site named "${fields.name}" exists already`);
    }
    const known = new Set(ProviderRepository.findAll().map((p) => p.id));
    const unknown = fields.providerIds.find((id) => !known.has(id));
    if (unknown) throw new RequestError(400, `There is no provider with the id ${unknown}`);
}

/** The records of a site, by id. */
const recordsOf = (siteId: string) => RecordRepository.findAll().filter((r) => r.siteIds.includes(siteId)).map((r) => r.id);

/**
 * The sites: groups of providers that give the same answers. A record goes to every provider
 * of its sites, so changing which providers a site has is what moves records between DNS
 * servers: a provider that joins gets the site's records written, one that leaves has them
 * removed -- in the background, one record after another.
 */
export class SiteService {
    static create(fields: SiteFields, user: string): Site {
        check(fields);
        const id = randomUUID();
        SiteRepository.create(id, fields);
        ActivityService.record({
            kind: "site.created",
            level: "info",
            source: "user",
            subject: { siteId: id },
            data: { user, name: fields.name, providers: providerNames(fields.providerIds) },
        });
        return SiteRepository.findById(id)!;
    }

    static update(id: string, fields: SiteFields, user: string): Site {
        const before = SiteRepository.findById(id);
        if (!before) throw new RequestError(404, "Site not found");
        check(fields, id);
        SiteRepository.update(id, fields);
        if (before.providerIds.join() !== [...fields.providerIds].sort().join()) SyncService.syncSoon(recordsOf(id));
        const changes = fieldChanges(describe(before), describe(fields));
        if (changes.length > 0) {
            ActivityService.record({
                kind: "site.changed",
                level: "info",
                source: "user",
                subject: { siteId: id },
                data: { user, name: fields.name, changes },
            });
        }
        return SiteRepository.findById(id)!;
    }

    /**
     * Its records lose the site and leave its providers. One that belonged to this site alone
     * is parked: dpm keeps it, and writes it nowhere until it gets a site again.
     */
    static delete(id: string, user: string): void {
        const site = SiteRepository.findById(id);
        if (!site) throw new RequestError(404, "Site not found");
        const records = recordsOf(id);
        SiteRepository.delete(id);
        SyncService.syncSoon(records);
        ActivityService.record({
            kind: "site.deleted",
            level: "info",
            source: "user",
            subject: { siteId: id },
            data: { user, name: site.name, providers: providerNames(site.providerIds) },
        });
    }
}
