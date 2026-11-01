import { ACTIVITY_KINDS } from "@dpm/shared";
import type { SettingsValues } from "../../../queries/settings";
import type { SectionDef, SectionId } from "../sections";
import { choiceOf } from "./eventLevels";

/** What the toast after a section's Save is headed with: the settings saved, not the things they are about. */
const SAVED_TITLE: Record<SectionId, string> = {
    providers: "Provider settings saved",
    activity: "Activity history settings saved",
};

const every = (count: number, unit: string) => (count === 1 ? `every ${unit}` : `every ${count} ${unit}s`);
const count = (n: number, unit: string) => `${n} ${n === 1 ? unit : `${unit}s`}`;
const number = (value: string | undefined) => parseInt(value ?? "", 10) || 0;

/** An interval as a phrase: "every 5 minutes", or what `0` means for it. */
const interval = (value: string | undefined, unit: string, off: string) => {
    const n = number(value);
    return n === 0 ? off : every(n, unit);
};

/**
 * What one changed setting means now, in a sentence, with what it was before. Null for a key
 * this page does not word: it is saved all the same.
 */
function describeChange(key: string, before: string | undefined, after: string | undefined): string | null {
    switch (key) {
        case "provider_read_interval_minutes":
            return `The providers are read ${interval(after, "minute", "only on request")} (was ${interval(before, "minute", "only on request")}).`;
        case "cluster_sync_interval_minutes":
            return `The AdGuard Home clusters are kept alike ${interval(after, "minute", "only on request")} (was ${interval(before, "minute", "only on request")}).`;
        case "notification_retention_days":
            return `Events are kept for ${count(number(after), "day")} (was ${count(number(before), "day")}).`;
        case "notification_retention_count":
            return `At least ${count(number(after), "event")} are always kept (was ${count(number(before), "event")}).`;
        case "notification_cleanup_interval_hours":
            return `The cleanup runs ${interval(after, "hour", "only on request")} (was ${interval(before, "hour", "only on request")}).`;
        case "activity_level_overrides": {
            const changed = ACTIVITY_KINDS.filter((kind) => choiceOf(before ?? "", kind) !== choiceOf(after ?? "", kind)).length;
            return changed === 0 ? null : `The level of ${count(changed, "event kind")} changed; it applies to events from now on.`;
        }
        default:
            return null;
    }
}

/**
 * The toast after a section was saved: headed with whose settings they are, and naming every
 * setting the save changed, with its value before -- so it says what the save did rather than
 * that something was saved.
 */
export function describeSettingsSave(section: SectionDef, before: SettingsValues, after: SettingsValues): { title: string; description?: string } {
    const lines = section.keys
        .filter((key) => (before[key] ?? "") !== (after[key] ?? ""))
        .map((key) => describeChange(key, before[key], after[key]))
        .filter((line): line is string => line !== null);
    return lines.length > 0 ? { title: SAVED_TITLE[section.id], description: lines.join(" ") } : { title: SAVED_TITLE[section.id] };
}
