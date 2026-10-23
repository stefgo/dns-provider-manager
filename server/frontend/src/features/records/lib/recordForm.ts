import { TTL_MAX, TTL_MIN, type DnsRecord, type RecordInput, type RecordType } from "@dpm/shared";
import type { FieldErrors } from "../../../lib/entityForm";

/** TTL and proxy at one provider, as typed. The TTL is text until it is sent; empty is the default. */
export interface SettingDraft {
    ttl: string;
    proxied: boolean;
}

/**
 * The editor's fields, as typed. `settings` holds, by provider id, only the providers whose
 * TTL or proxy differs from the defaults -- so a setting typed back to the default is no change.
 */
export interface RecordDraft {
    name: string;
    type: RecordType;
    value: string;
    settings: Record<string, SettingDraft>;
    siteIds: string[];
    note: string;
}

export const EMPTY_RECORD_DRAFT: RecordDraft = {
    name: "",
    type: "A",
    value: "",
    settings: {},
    siteIds: [],
    note: "",
};

export const DEFAULT_SETTING: SettingDraft = { ttl: "", proxied: false };

export function recordDraftFrom(record: DnsRecord): RecordDraft {
    return {
        name: record.name,
        type: record.type,
        value: record.value,
        settings: Object.fromEntries(
            record.settings.map((s) => [s.providerId, { ttl: s.ttl === null ? "" : String(s.ttl), proxied: s.proxied }]),
        ),
        siteIds: record.siteIds,
        note: record.note,
    };
}

/** The settings with one provider's changed; one that is back at the defaults is dropped. */
export function withSetting(settings: Record<string, SettingDraft>, providerId: string, change: Partial<SettingDraft>): Record<string, SettingDraft> {
    const { [providerId]: current, ...others } = settings;
    const next = { ...DEFAULT_SETTING, ...current, ...change };
    return next.ttl.trim() === "" && !next.proxied ? others : { ...others, [providerId]: next };
}

/** The draft as the API takes it. An empty TTL is null, the provider's default. */
export function recordInputFrom(draft: RecordDraft): RecordInput {
    return {
        name: draft.name,
        type: draft.type,
        value: draft.value,
        settings: Object.entries(draft.settings).map(([providerId, setting]) => {
            const ttl = setting.ttl.trim();
            return { providerId, ttl: ttl === "" ? null : Number(ttl), proxied: setting.proxied };
        }),
        siteIds: draft.siteIds,
        note: draft.note,
    };
}

/**
 * What is wrong with each provider's TTL, by provider id. The schema would name only the
 * position in a list, and "expected number" for a TTL that is no whole number at all.
 */
export function settingErrors(draft: Pick<RecordDraft, "settings">): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const [providerId, setting] of Object.entries(draft.settings)) {
        const ttl = setting.ttl.trim();
        if (ttl === "") continue;
        if (!/^\d+$/.test(ttl)) errors[providerId] = "Whole seconds, or empty for the provider's default";
        else if (Number(ttl) < TTL_MIN) errors[providerId] = `At least ${TTL_MIN} seconds`;
        else if (Number(ttl) > TTL_MAX) errors[providerId] = `At most ${TTL_MAX} seconds`;
    }
    return errors;
}

/** A TTL in error holds the save back; it is shown at its provider, not here. */
export function recordRules(draft: RecordDraft): FieldErrors<RecordDraft> {
    const [first] = Object.values(settingErrors(draft));
    return first ? { settings: first } : {};
}

/** What the value field asks for, per type. */
export const VALUE_PLACEHOLDER: Record<RecordType, string> = {
    A: "192.168.1.10",
    AAAA: "2001:db8::10",
    CNAME: "host.example.com",
};
