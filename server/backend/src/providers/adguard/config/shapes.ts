/**
 * What the areas of AdGuard Home's configuration share: reading its answers defensively and
 * bringing them into a form two instances can be compared in.
 *
 * AdGuard Home sends an empty list as `null` or `[]`, depending on the version and on whether
 * the list was ever set; both are an empty list here.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** The answer as an object, or an error that names what was expected. */
export function objectOf(raw: unknown, what: string): JsonObject {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`AdGuard Home sent no ${what}`);
    return raw as JsonObject;
}

/** A list of strings, `null` and a missing list as empty; what is no string is left out. */
export function stringList(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

/** A list of strings whose order means nothing to AdGuard Home, in one order. */
export function sortedList(raw: unknown): string[] {
    return [...new Set(stringList(raw))].sort();
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * A schedule of blocked services. AdGuard Home leaves out a day without a time range, so every
 * day is named here, `null` where it has none: the same schedule then has the same keys.
 */
export function normaliseSchedule(raw: unknown): JsonObject {
    const schedule = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as JsonObject) : {};
    const out: JsonObject = { time_zone: typeof schedule.time_zone === "string" ? schedule.time_zone : "Local" };
    for (const day of DAYS) {
        const range = schedule[day];
        out[day] =
            range !== null && typeof range === "object" && !Array.isArray(range) && typeof range.start === "number" && typeof range.end === "number"
                ? { start: range.start, end: range.end }
                : null;
    }
    return out;
}

/** A schedule as AdGuard Home takes it: a day without a time range is left out. */
export function scheduleForApi(schedule: Json | undefined): JsonObject {
    const out: JsonObject = {};
    if (schedule === null || typeof schedule !== "object" || Array.isArray(schedule)) return out;
    for (const [key, value] of Object.entries(schedule)) if (value !== null) out[key] = value;
    return out;
}

/**
 * `top` written over `base`, object by object; a list or a value of `top` replaces that of
 * `base`. What a copy is sent is the primary's state over what the copy holds, so that a field
 * the cluster does not compare -- one an older node of the cluster does not know -- keeps the
 * copy's own value instead of falling back to a default.
 */
export function mergeOver(base: Json | undefined, top: Json | undefined): Json {
    if (top === undefined) return base ?? null;
    if (isObject(base) && isObject(top)) {
        const out: JsonObject = { ...base };
        for (const [key, value] of Object.entries(top)) out[key] = mergeOver(base[key], value);
        return out;
    }
    return top;
}

const isObject = (value: Json | undefined): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

/** `["a", "b"]` → `a, b`; the first few of a long list and how many more. */
export function listed(items: readonly string[], most = 5): string {
    if (items.length <= most) return items.join(", ");
    return `${items.slice(0, most).join(", ")} and ${items.length - most} more`;
}
