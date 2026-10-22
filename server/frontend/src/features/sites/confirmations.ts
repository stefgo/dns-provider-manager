import type { AlertOptions, ConfirmOptions } from "@stefgo/react-ui-components";
import type { Site } from "@dpm/shared";
import { plural } from "../../utils";

/**
 * Deleting a site whose records all have another one: they keep those, and lose this one.
 * `shared` is how many of its records belong to another site as well.
 */
export function describeDeleteSite(site: Pick<Site, "name">, shared: number): ConfirmOptions {
    return {
        title: `Delete the site "${site.name}"?`,
        description:
            shared > 0
                ? `${shared === 1 ? "Its record keeps" : `Its ${shared} records keep`} their other sites and leave this one. Its providers stay as they are.`
                : "No record belongs to it. Its providers stay as they are.",
        confirmLabel: "Delete site",
        variant: "danger",
    };
}

/**
 * Why a site cannot be deleted yet: records that belong to it alone would be left with
 * nowhere to go. A notice, not a mode of the delete dialog -- it must not reach the request.
 */
export function describeSiteInUse(site: Pick<Site, "name">, alone: readonly string[]): AlertOptions {
    const shown = alone.slice(0, 3).join(", ");
    const more = alone.length > 3 ? ` and ${alone.length - 3} more` : "";
    return {
        title: `The site "${site.name}" cannot be deleted yet`,
        description: `${plural(alone.length, "record")} ${alone.length === 1 ? "belongs" : "belong"} to it alone (${shown}${more}). Give ${alone.length === 1 ? "it" : "them"} another site or delete ${alone.length === 1 ? "it" : "them"} first.`,
    };
}
