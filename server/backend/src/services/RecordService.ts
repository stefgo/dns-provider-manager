import { randomUUID } from "crypto";
import { recordConflict, type DnsRecord, type RecordFields } from "@dpm/shared";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ActivityService } from "./ActivityService.js";
import { RequestError } from "./RequestError.js";
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
        sites: nameList(siteNames(record.siteIds)),
        note: record.note || "–",
    };
}

/**
 * Refuses sites that do not exist, and a record that cannot stand next to the others
 * (`recordConflict`): the same record twice, or a CNAME beside another record of its name
 * wherever the two would be answered by the same DNS server.
 */
function check(fields: RecordFields, exceptId?: string): void {
    const sites = SiteRepository.findAll();
    const unknown = fields.siteIds.find((id) => !sites.some((s) => s.id === id));
    if (unknown) throw new RequestError(400, `There is no site with the id ${unknown}`);
    const conflict = recordConflict(
        { ...fields, id: exceptId },
        RecordRepository.findAll(),
        sites,
        ProviderRepository.findAll(),
    );
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

/**
 * The records dpm manages. Today they are stored and checked; writing them to the
 * providers of their sites follows with the providers themselves.
 */
export class RecordService {
    static create(fields: RecordFields, user: string): DnsRecord {
        check(fields);
        const id = randomUUID();
        RecordRepository.create(id, fields, user);
        ActivityService.record({
            kind: "record.created",
            level: "info",
            source: "user",
            subject: { recordId: id },
            data: facts(fields, user),
        });
        return RecordRepository.findById(id)!;
    }

    static update(id: string, fields: RecordFields, user: string): DnsRecord {
        const before = RecordRepository.findById(id);
        if (!before) throw new RequestError(404, "Record not found");
        check(fields, id);
        const changes = fieldChanges(describe(before), describe(fields));
        // Nothing changed, nothing to stamp: the record keeps who changed it last.
        if (changes.length === 0) return before;
        RecordRepository.update(id, fields, user);
        ActivityService.record({
            kind: "record.changed",
            level: "info",
            source: "user",
            subject: { recordId: id },
            data: { ...facts(fields, user), changes },
        });
        return RecordRepository.findById(id)!;
    }

    static delete(id: string, user: string): void {
        const record = RecordRepository.findById(id);
        if (!record) throw new RequestError(404, "Record not found");
        RecordRepository.delete(id);
        ActivityService.record({
            kind: "record.deleted",
            level: "info",
            source: "user",
            subject: { recordId: id },
            data: facts(record, user),
        });
    }
}
