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
import { RecordRepository } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { ActivityService } from "./ActivityService.js";
import { ProviderReadService } from "./ProviderReadService.js";
import { RequestError } from "./RequestError.js";
import { unmanagedEntries } from "./unmanaged.js";

function current(): UnmanagedEntry[] {
    return unmanagedEntries(
        ProviderReadService.entries(),
        ProviderRepository.findAll(),
        RecordRepository.findAll(),
        SiteRepository.findAll(),
    );
}

/**
 * What the providers hold and dpm does not manage, and taking it over. Taking over writes
 * nothing to a provider: the entry is there already, and from now on dpm has the record.
 */
export class UnmanagedService {
    static list(): UnmanagedResponse {
        return { readings: ProviderReadService.readings(), entries: current() };
    }

    /**
     * Takes the entries over into one site, one after another. An entry whose record dpm
     * has in other sites gives that record this site; every other one becomes a record of
     * its own, with the entry's TTL and proxy setting. What cannot be taken over is refused
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
            const parsed = RecordInputSchema.safeParse(
                existing
                    ? { ...existing, siteIds: [...existing.siteIds, siteId] }
                    : { name: entry.name, type: entry.type, value: entry.value, ttl: entry.ttl, proxied: entry.proxied, siteIds: [siteId] },
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
