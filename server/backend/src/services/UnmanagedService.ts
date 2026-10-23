import { randomUUID } from "crypto";
import {
    RecordInputSchema,
    firstIssue,
    recordConflict,
    type AdoptResult,
    type UnmanagedEntry,
    type UnmanagedResponse,
} from "@dpm/shared";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { RecordLinkRepository } from "../repositories/RecordLinkRepository.js";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { ActivityService } from "./ActivityService.js";
import { ProviderReadService } from "./ProviderReadService.js";
import { RequestError } from "./RequestError.js";
import { SyncService } from "./SyncService.js";
import { claimKey } from "./syncPlan.js";
import { unmanagedEntries } from "./unmanaged.js";

/** The entries a record holds, or sees as what it drifted to. */
function claimed(): Set<string> {
    const keys = new Set<string>();
    for (const link of RecordLinkRepository.findAll()) {
        if (link.externalId) keys.add(claimKey(link.providerId, link.externalId));
        if (link.observed) keys.add(claimKey(link.providerId, link.observed.externalId));
    }
    return keys;
}

function current(): UnmanagedEntry[] {
    return unmanagedEntries(
        ProviderReadService.entries(),
        ProviderRepository.findAll(),
        RecordRepository.findAll(),
        SiteRepository.findAll(),
        claimed(),
    );
}

/**
 * What the providers hold and dpm does not manage, and taking it over. The entry itself is
 * left as it is: from now on dpm has the record, and holds this entry as its own. The other
 * providers of the site get the record written, in the background.
 */
/** The entry a provider's last reading holds under this id. */
const readEntry = (providerId: string, externalId: string) =>
    ProviderReadService.entries()
        .get(providerId)
        ?.find((e) => e.externalId === externalId);

export class UnmanagedService {
    static list(): UnmanagedResponse {
        return { readings: ProviderReadService.readings(), entries: current() };
    }

    /**
     * Takes the entries over into one site, one after another. An entry whose record dpm
     * has in other sites gives that record this site; every other one becomes a record of
     * its own. Either way the entry's TTL and proxy become the record's setting for its provider. What cannot be taken over is refused
     * with its reason, and the rest goes ahead -- a bulk adoption is not all or nothing.
     *
     * The site has to be one of the entry's provider: taking an entry over means dpm will
     * write it there from now on. Moving it to another site is a change of the record after.
     */
    static adopt(siteId: string, refs: readonly { providerId: string; externalId: string }[], user: string): AdoptResult {
        const site = SiteRepository.findById(siteId);
        if (!site) throw new RequestError(400, `There is no site with the id ${siteId}`);
        const providers = ProviderRepository.findAll();
        const correlationId = randomUUID();
        const result: AdoptResult = { adopted: [], refused: [] };
        const adoptedIds: string[] = [];

        for (const ref of refs) {
            const entry = current().find((e) => e.providerId === ref.providerId && e.externalId === ref.externalId);
            if (!entry) {
                result.refused.push({ name: ref.externalId, type: "", value: "", reason: "Not among the unmanaged entries any more; read the provider again" });
                continue;
            }
            const refuse = (reason: string) => result.refused.push({ name: entry.name, type: entry.type, value: entry.value, reason });
            const provider = providers.find((p) => p.id === entry.providerId);
            if (!site.providerIds.includes(entry.providerId)) {
                refuse(`The site "${site.name}" does not write to ${provider?.name ?? "this provider"}`);
                continue;
            }
            if (entry.problem) {
                refuse(entry.problem);
                continue;
            }

            const records = RecordRepository.findAll();
            const sites = SiteRepository.findAll();
            const existing = records.find((r) => r.name === entry.name && r.type === entry.type && r.value === entry.value);
            const setting = { providerId: entry.providerId, ttl: entry.ttl, proxied: entry.proxied };
            const parsed = RecordInputSchema.safeParse(
                existing
                    ? {
                          ...existing,
                          settings: [...existing.settings.filter((s) => s.providerId !== entry.providerId), setting],
                          siteIds: [...existing.siteIds, siteId],
                      }
                    : { name: entry.name, type: entry.type, value: entry.value, settings: [setting], siteIds: [siteId] },
            );
            if (!parsed.success) {
                refuse(firstIssue(parsed.error));
                continue;
            }
            const conflict = recordConflict({ ...parsed.data, id: existing?.id }, records, sites, providers);
            if (conflict) {
                refuse(conflict);
                continue;
            }

            const id = existing?.id ?? randomUUID();
            if (existing) RecordRepository.update(id, parsed.data, user);
            else RecordRepository.create(id, parsed.data, user);
            RecordLinkRepository.save({
                recordId: id,
                providerId: entry.providerId,
                zoneId: readEntry(entry.providerId, entry.externalId)?.zoneId ?? null,
                externalId: entry.externalId,
                written: { name: entry.name, type: entry.type, value: entry.value, ttl: entry.ttl, proxied: entry.proxied },
                status: "in_sync",
                error: null,
                observed: null,
                attempts: 0,
                lastAttemptAt: null,
                syncedAt: new Date().toISOString(),
            });
            adoptedIds.push(id);
            ActivityService.record({
                kind: "record.adopted",
                level: "info",
                source: "user",
                correlationId,
                subject: { recordId: id, providerId: entry.providerId },
                data: {
                    user,
                    name: entry.name,
                    type: entry.type,
                    value: entry.value,
                    sites: sites.filter((s) => parsed.data.siteIds.includes(s.id)).map((s) => s.name),
                    provider: provider?.name ?? entry.providerId,
                    merged: existing !== undefined,
                },
            });
            result.adopted.push({ name: entry.name, type: entry.type, value: entry.value, merged: existing !== undefined });
        }
        SyncService.syncSoon(adoptedIds, { correlationId });
        // The records are the steps of one operation; with more than one, it gets a line of
        // its own that heads them in the activity.
        if (result.adopted.length > 1) {
            ActivityService.record({
                kind: "record.adoption",
                level: "info",
                source: "user",
                correlationId,
                subject: { siteId },
                data: {
                    user,
                    count: result.adopted.length,
                    site: site.name,
                    providers: [...new Set(refs.map((r) => providers.find((p) => p.id === r.providerId)?.name ?? r.providerId))],
                },
            });
        }
        return result;
    }
}
