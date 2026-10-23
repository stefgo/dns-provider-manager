import { randomUUID } from "crypto";
import { RecordInputSchema, firstIssue, recordConflict, type DnsRecord, type RecordFields } from "@dpm/shared";
import { CAPABILITIES } from "../providers/DnsProvider.js";
import { RecordLinkRepository } from "../repositories/RecordLinkRepository.js";
import { RecordRepository, type StoredRecord } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ActivityService } from "./ActivityService.js";
import { RequestError } from "./RequestError.js";
import { SyncService } from "./SyncService.js";
import { fieldChanges, nameList } from "./changes.js";

function siteNames(ids: readonly string[]): string[] {
    const sites = SiteRepository.findAll();
    return ids.map((id) => sites.find((s) => s.id === id)?.name ?? id);
}

function describe(record: Omit<RecordFields, "note"> & { note: string }): Record<string, string> {
    return {
        name: record.name,
        type: record.type,
        value: record.value,
        ttl: record.ttl === null ? "default" : `${record.ttl} s`,
        proxied: record.proxied ? "on" : "off",
        sites: record.siteIds.length > 0 ? nameList(siteNames(record.siteIds)) : "none",
        note: record.note || "–",
    };
}

/**
 * Refuses sites that do not exist, a record that cannot stand next to the others
 * (`recordConflict`): the same record twice, or a CNAME beside another record of its name
 * wherever the two would be answered by the same DNS server -- and a record a provider could
 * not take: a name in none of the zones of a site, a CNAME beside an entry dpm does not manage.
 */
function check(fields: RecordFields, exceptId?: string): void {
    const sites = SiteRepository.findAll();
    const unknown = fields.siteIds.find((id) => !sites.some((s) => s.id === id));
    if (unknown) throw new RequestError(400, `There is no site with the id ${unknown}`);
    const conflict =
        recordConflict({ ...fields, id: exceptId }, RecordRepository.findAll(), sites, ProviderRepository.findAll()) ??
        SyncService.preview(fields, exceptId).conflict;
    if (conflict) throw new RequestError(409, conflict);
}

/** What an event says about a record, besides what changed. */
const facts = (record: Pick<DnsRecord, "name" | "type" | "value" | "siteIds">, user: string) => ({
    user,
    name: record.name,
    type: record.type,
    value: record.value,
    sites: siteNames(record.siteIds),
});

const fieldsOf = (record: StoredRecord): RecordFields => ({
    name: record.name,
    type: record.type,
    value: record.value,
    ttl: record.ttl,
    proxied: record.proxied,
    siteIds: record.siteIds,
    note: record.note,
});

/**
 * The records dpm manages. Each change is stored, then written to the providers of the
 * record's sites; the answer comes once that is done, and says per provider how it went. A
 * provider that fails does not undo the change: it is tried again after its next reading.
 */
export class RecordService {
    static async create(fields: RecordFields, user: string): Promise<DnsRecord> {
        check(fields);
        const id = randomUUID();
        const correlationId = randomUUID();
        RecordRepository.create(id, fields, user);
        ActivityService.record({
            kind: "record.created",
            level: "info",
            source: "user",
            correlationId,
            subject: { recordId: id },
            data: facts(fields, user),
        });
        await SyncService.syncRecord(id, { correlationId });
        return SyncService.view(id)!;
    }

    static async update(id: string, fields: RecordFields, user: string): Promise<DnsRecord> {
        const before = RecordRepository.findById(id);
        if (!before) throw new RequestError(404, "Record not found");
        check(fields, id);
        const changes = fieldChanges(describe(before), describe(fields));
        // Nothing changed, nothing to stamp: the record keeps who changed it last.
        if (changes.length === 0) return SyncService.view(id)!;
        const correlationId = randomUUID();
        RecordRepository.update(id, fields, user);
        ActivityService.record({
            kind: "record.changed",
            level: "info",
            source: "user",
            correlationId,
            subject: { recordId: id },
            data: { ...facts(fields, user), changes },
        });
        await SyncService.syncRecord(id, { correlationId });
        return SyncService.view(id)!;
    }

    /**
     * Deletes the record and removes it from every provider dpm wrote it to. A provider that
     * cannot be reached keeps it until it can: the removal is tried again after its readings.
     */
    static async delete(id: string, user: string): Promise<void> {
        const record = RecordRepository.findById(id);
        if (!record) throw new RequestError(404, "Record not found");
        const correlationId = randomUUID();
        RecordRepository.delete(id);
        ActivityService.record({
            kind: "record.deleted",
            level: "info",
            source: "user",
            correlationId,
            subject: { recordId: id },
            data: facts(record, user),
        });
        await SyncService.syncRecord(id, { correlationId });
    }

    /** Writes the record to its providers again: what failed, and what drifted there. */
    static async sync(id: string, user: string): Promise<DnsRecord> {
        const record = RecordRepository.findById(id);
        if (!record) throw new RequestError(404, "Record not found");
        const drifted = RecordLinkRepository.findByRecord(id)
            .filter((l) => l.status === "drift" || l.status === "missing")
            .map((l) => l.providerId);
        await SyncService.syncRecord(id, { correct: new Set(drifted), user });
        return SyncService.view(id)!;
    }

    /** Writes dpm's value over what the provider holds instead. */
    static async rewrite(id: string, providerId: string, user: string): Promise<DnsRecord> {
        if (!RecordRepository.findById(id)) throw new RequestError(404, "Record not found");
        const link = RecordLinkRepository.find(id, providerId);
        if (!link || (link.status !== "drift" && link.status !== "missing")) {
            throw new RequestError(409, "The provider holds the record as dpm wrote it");
        }
        const provider = ProviderRepository.findById(providerId);
        if (!provider?.writable) throw new RequestError(409, `dpm does not write to ${provider?.name ?? "this provider"}`);
        await SyncService.syncRecord(id, { correct: new Set([providerId]), user });
        return SyncService.view(id)!;
    }

    /**
     * Takes over what the provider holds instead of dpm's value.
     *
     * - Changed there: the record takes the provider's value -- and goes with it to all its
     *   other providers.
     * - Deleted or switched off there: the record leaves the sites it reached the provider
     *   through, and with them their other providers; with no site left, it is parked. What
     *   the provider holds is not touched.
     */
    static async accept(id: string, providerId: string, user: string): Promise<DnsRecord> {
        const record = RecordRepository.findById(id);
        if (!record) throw new RequestError(404, "Record not found");
        const link = RecordLinkRepository.find(id, providerId);
        const provider = ProviderRepository.findById(providerId);
        if (!link || !provider || (link.status !== "drift" && link.status !== "missing")) {
            throw new RequestError(409, "The provider holds the record as dpm wrote it");
        }
        const event = () =>
            ActivityService.record({
                kind: "record.accepted",
                level: "info",
                source: "user",
                subject: { recordId: id, providerId },
                data: { user, name: record.name, type: record.type, value: record.value, provider: provider.name },
            });

        const observed = link.observed;
        if (link.status === "drift" && observed && !observed.disabled) {
            const caps = CAPABILITIES[provider.type];
            const parsed = RecordInputSchema.safeParse({
                ...fieldsOf(record),
                name: observed.name,
                value: observed.value,
                ttl: caps.ttl ? observed.ttl : record.ttl,
                proxied: caps.proxied ? observed.proxied : record.proxied,
            });
            if (!parsed.success) throw new RequestError(409, `dpm cannot take over ${observed.value}: ${firstIssue(parsed.error)}`);
            check(parsed.data, id);
            event();
            // What the provider holds is what dpm has written there from now on.
            RecordLinkRepository.save({
                ...link,
                externalId: observed.externalId,
                written: { name: parsed.data.name, type: parsed.data.type, value: parsed.data.value, ttl: parsed.data.ttl, proxied: parsed.data.proxied },
                status: "in_sync",
                error: null,
                observed: null,
            });
            return this.update(id, parsed.data, user);
        }

        const through = SiteRepository.findAll()
            .filter((s) => record.siteIds.includes(s.id) && s.providerIds.includes(providerId))
            .map((s) => s.id);
        event();
        // dpm stops managing what is left there, rather than removing it.
        RecordLinkRepository.delete(id, providerId);
        const siteIds = record.siteIds.filter((s) => !through.includes(s));
        return this.update(id, { ...fieldsOf(record), siteIds }, user);
    }
}
