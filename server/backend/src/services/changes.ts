/** One field that changed, both values written as text -- what a `*.changed` event carries. */
export interface FieldChange {
    field: string;
    from: string;
    to: string;
}

/**
 * The fields whose text differs between two descriptions of the same thing, in the order of
 * `after`. A description is what a reader of the activity would call each field, written out
 * already, so the event needs no lookup to be read later -- a site renamed since still reads
 * as it was called then.
 */
export function fieldChanges(before: Record<string, string>, after: Record<string, string>): FieldChange[] {
    return Object.keys(after)
        .filter((field) => before[field] !== after[field])
        .map((field) => ({ field, from: before[field] ?? "–", to: after[field] }));
}

/** A list of names for a description: sorted, so another order is no change. */
export const nameList = (names: readonly string[]): string => (names.length > 0 ? [...names].sort().join(", ") : "–");
