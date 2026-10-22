import type { ActivityRecord } from "@dpm/shared";
import { groupActivity } from "../../activity/lib/groupActivity";
import { plural } from "../../../utils";

/**
 * The numbers the dashboard's cards show. Counted here, once, so a card and a badge that
 * show the same number cannot disagree about it.
 */

/** The rows the user has not seen that ask for a look, by how loudly. */
export interface UnseenProblems {
    errors: number;
    warnings: number;
}

/**
 * What the activity list opens on from the Errors / Warnings card: unseen rows at warning
 * and above, counted as rows -- grouped the way the list groups them, each at the level its
 * row carries.
 */
export function unseenProblems(events: ActivityRecord[]): UnseenProblems {
    let errors = 0;
    let warnings = 0;
    for (const group of groupActivity(events)) {
        if (!group.unseen) continue;
        if (group.level === "error") errors++;
        else if (group.level === "warning") warnings++;
    }
    return { errors, warnings };
}

/**
 * What the "Errors / Warnings" card says below its number: what the number is made of.
 * A part that is zero is left out, and with nothing unseen the card says that instead.
 */
export function problemSummary({ errors, warnings }: UnseenProblems): string {
    const parts = [
        errors > 0 ? plural(errors, "error") : null,
        warnings > 0 ? plural(warnings, "warning") : null,
    ].filter((part) => part !== null);
    return parts.length > 0 ? parts.join(" · ") : "Nothing unseen";
}
