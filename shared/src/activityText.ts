import type { ActivityRecord } from "./types.js";

/**
 * Turns an event into the sentence a reader sees -- on the dashboard and in a webhook alike.
 *
 * This is the one place a wording exists. An event carries facts (`kind`, `subject`, `data`)
 * and no sentence, so a wording can be changed here without touching what is stored.
 *
 * A kind nobody here knows still has to read as something: the fallback prints the kind
 * itself, because dropping the line would hide an event that cannot be recorded again.
 */

/** The server's schedulers as the settings page names them. */
const SCHEDULER_NAMES: Record<string, string> = {
    "notification-cleanup": "Activity cleanup",
    "provider-read": "Reading the providers",
};

function str(event: ActivityRecord, key: string): string | null {
    const value = event.data?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** " by admin", or nothing for a change nobody signed. */
function by(event: ActivityRecord): string {
    const user = str(event, "user");
    return user ? ` by ${user}` : "";
}

/** "app.example.com A 192.168.1.10", as far as the event names it. */
function recordLabel(event: ActivityRecord): string {
    return [str(event, "name") ?? "A record", str(event, "type"), str(event, "value")].filter(Boolean).join(" ");
}

const PAST: Record<string, string> = { created: "added", changed: "changed", deleted: "deleted" };

/**
 * One change of a `*.changed` event, as `data.changes` carries it: the field and its old and
 * new value, each already written as text.
 */
interface Change {
    field: string;
    from: string;
    to: string;
}

function changes(event: ActivityRecord): Change[] {
    const value = event.data?.changes;
    if (!Array.isArray(value)) return [];
    return value.filter(
        (c): c is Change =>
            typeof c === "object" &&
            c !== null &&
            typeof (c as Change).field === "string" &&
            typeof (c as Change).from === "string" &&
            typeof (c as Change).to === "string",
    );
}

export function activityMessage(event: ActivityRecord): string {
    const [area, action] = event.kind.split(".");
    const past = PAST[action];
    if (past) {
        switch (area) {
            case "record":
                return `Record ${recordLabel(event)} ${past}${by(event)}`;
            case "site":
                return `Site ${str(event, "name") ?? "?"} ${past}${by(event)}`;
            case "provider":
                return `Provider ${str(event, "name") ?? "?"} ${past}${by(event)}`;
        }
    }
    switch (event.kind) {
        case "record.adoption": {
            const count = event.data?.count;
            const records = typeof count === "number" ? (count === 1 ? "1 record" : `${count} records`) : "Records";
            return `${records} adopted into ${str(event, "site") ?? "a site"}${by(event)}`;
        }
        case "record.adopted":
            return `Record ${recordLabel(event)} adopted from ${str(event, "provider") ?? "a provider"}${by(event)}`;
        case "record.written": {
            const provider = str(event, "provider") ?? "a provider";
            const action = str(event, "action");
            const done = action === "deleted" ? `removed from ${provider}` : action === "updated" ? `updated at ${provider}` : `written to ${provider}`;
            return `Record ${recordLabel(event)} ${done}`;
        }
        case "record.write_failed":
            return `Record ${recordLabel(event)} could not be ${str(event, "action") === "deleted" ? "removed from" : "written to"} ${str(event, "provider") ?? "a provider"}`;
        case "record.drift": {
            const change = str(event, "change");
            const what = change === "missing" ? "deleted" : change === "disabled" ? "switched off" : "changed";
            return `Record ${recordLabel(event)} was ${what} at ${str(event, "provider") ?? "a provider"}`;
        }
        case "record.corrected": {
            const how = event.data?.auto === true ? " automatically" : by(event);
            return `Record ${recordLabel(event)} written again to ${str(event, "provider") ?? "a provider"}${how}`;
        }
        case "record.accepted":
            return `Record ${recordLabel(event)} takes over what ${str(event, "provider") ?? "a provider"} holds${by(event)}`;
        case "record.released":
            return `Record ${recordLabel(event)} released${by(event)}`;
        case "provider.unreachable":
            return `Provider ${str(event, "name") ?? "?"} cannot be read`;
        case "provider.recovered":
            return `Provider ${str(event, "name") ?? "?"} can be read again`;
        case "scheduler.failed": {
            const scheduler = str(event, "scheduler");
            const error = str(event, "error");
            const what = scheduler ? (SCHEDULER_NAMES[scheduler] ?? scheduler) : "A scheduled job";
            return error ? `${what} failed: ${error}` : `${what} failed`;
        }
        default:
            // A kind from another version. Better an unpolished line than none.
            return event.kind;
    }
}

/** The second line of an expanded row: what the message left out. */
export function activityDetail(event: ActivityRecord): string | null {
    const error = str(event, "error");
    if (error) return error;

    const observed = str(event, "observed");
    if (observed) return `${str(event, "provider") ?? "The provider"} holds ${observed}`;

    const changed = changes(event);
    if (changed.length > 0) return changed.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(" · ");

    // What a released record left behind, rather than the sites it had.
    const kept = event.kind === "record.released" ? strings(event.data?.providers) : [];
    if (kept.length > 0) return `Left as it is at ${kept.join(", ")}`;

    const sites = strings(event.data?.sites);
    if (sites.length > 0) return `Sites: ${sites.join(", ")}`;
    const providers = strings(event.data?.providers);
    if (providers.length > 0) return `Providers: ${providers.join(", ")}`;
    return null;
}
