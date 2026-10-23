import type { ConfirmOptions } from "@stefgo/react-ui-components";
import type { Site } from "@dpm/shared";
import { plural } from "../../utils";

/**
 * Deleting a site: its records lose it. Those that belong to it `alone` are parked -- kept,
 * and removed from its providers; `shared` is how many keep another site.
 */
export function describeDeleteSite(site: Pick<Site, "name">, { alone, shared }: { alone: readonly string[]; shared: number }): ConfirmOptions {
    const parts: string[] = [];
    if (alone.length > 0) {
        const shown = alone.slice(0, 3).join(", ");
        const more = alone.length > 3 ? ` and ${alone.length - 3} more` : "";
        parts.push(
            `${plural(alone.length, "record")} ${alone.length === 1 ? "belongs" : "belong"} to it alone (${shown}${more}) and ${alone.length === 1 ? "is" : "are"} parked: kept here without a site, and removed from its providers.`,
        );
    }
    if (shared > 0) {
        const subject = alone.length > 0 ? (shared === 1 ? "The other record" : `The other ${shared} records`) : shared === 1 ? "Its record" : `Its ${shared} records`;
        parts.push(`${subject} ${shared === 1 ? "keeps its other sites and leaves" : "keep their other sites and leave"} this one.`);
    }
    if (parts.length === 0) parts.push("No record belongs to it.");
    return {
        title: `Delete the site "${site.name}"?`,
        description: `${parts.join(" ")} Its providers stay as they are.`,
        confirmLabel: "Delete site",
        variant: "danger",
    };
}
