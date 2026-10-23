import type { DnsRecord, RecordInput, RecordType } from "@dpm/shared";
import type { FieldErrors } from "../../../lib/entityForm";

/** The editor's fields, as typed. The TTL is text until it is sent; empty is the default. */
export interface RecordDraft {
    name: string;
    type: RecordType;
    value: string;
    ttl: string;
    proxied: boolean;
    siteIds: string[];
    note: string;
}

export const EMPTY_RECORD_DRAFT: RecordDraft = {
    name: "",
    type: "A",
    value: "",
    ttl: "",
    proxied: false,
    siteIds: [],
    note: "",
};

export function recordDraftFrom(record: DnsRecord): RecordDraft {
    return {
        name: record.name,
        type: record.type,
        value: record.value,
        ttl: record.ttl === null ? "" : String(record.ttl),
        proxied: record.proxied,
        siteIds: record.siteIds,
        note: record.note,
    };
}

/** The draft as the API takes it. An empty TTL is null, the provider's default. */
export function recordInputFrom(draft: RecordDraft): RecordInput {
    const ttl = draft.ttl.trim();
    return {
        name: draft.name,
        type: draft.type,
        value: draft.value,
        ttl: ttl === "" ? null : Number(ttl),
        proxied: draft.proxied,
        siteIds: draft.siteIds,
        note: draft.note,
    };
}

/** A TTL that is no whole number at all; the schema would only say "expected number". */
export function recordRules(draft: RecordDraft): FieldErrors<RecordDraft> {
    const ttl = draft.ttl.trim();
    return ttl !== "" && !/^\d+$/.test(ttl) ? { ttl: "Whole seconds, or empty for the provider's default" } : {};
}

/** What the value field asks for, per type. */
export const VALUE_PLACEHOLDER: Record<RecordType, string> = {
    A: "192.168.1.10",
    AAAA: "2001:db8::10",
    CNAME: "host.example.com",
};
