/**
 * DNS names as dpm stores them: lower case, without the trailing dot, labels of letters,
 * digits and hyphens. Pure, so the editor says what the server would refuse.
 *
 * Deliberately stricter than DNS itself, which takes any octet: these are host names that
 * an A, AAAA or CNAME record answers for, and every provider dpm writes to accepts this much.
 * An internationalised name is written in its ASCII form (`xn--…`).
 */

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The longest name DNS carries, written without the trailing dot. */
export const MAX_NAME_LENGTH = 253;

/** `App.Example.COM.` → `app.example.com`. Leaves anything else for the check to name. */
export function normaliseDnsName(text: string): string {
    const trimmed = text.trim().toLowerCase();
    return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Why a name cannot be used, or null. `wildcard` allows `*` as the leftmost label, which a
 * record's own name may have (`*.lab.example.com`) and the target of a CNAME may not.
 */
export function dnsNameError(name: string, { wildcard = false }: { wildcard?: boolean } = {}): string | null {
    if (name === "") return "Enter a name";
    if (name.length > MAX_NAME_LENGTH) return `At most ${MAX_NAME_LENGTH} characters`;
    const labels = name.split(".");
    for (const [index, label] of labels.entries()) {
        if (label === "") return "A name has no empty part between two dots";
        if (label === "*") {
            if (!wildcard) return "No * here";
            if (index !== 0) return "* stands only at the start";
            if (labels.length === 1) return "* needs a domain after it";
            continue;
        }
        if (label.length > 63) return `"${label.slice(0, 20)}…" is longer than 63 characters`;
        if (!LABEL.test(label)) {
            return `"${label}" may contain only letters, digits and hyphens, and not start or end with a hyphen`;
        }
    }
    return null;
}

/** Whether `name` is `zone` or lies below it. Both normalised. */
export function isInZone(name: string, zone: string): boolean {
    return name === zone || name.endsWith(`.${zone}`);
}
