import type { ConfirmOptions } from "@stefgo/react-ui-components";
import type { Provider, SitePreview } from "@dpm/shared";
import { plural } from "../../../utils";

/**
 * The question before a site's providers change, or null when no record moves: who gets the
 * site's records written, and who has them removed.
 */
export function describeSiteSync(
    siteName: string,
    preview: SitePreview,
    providers: readonly Pick<Provider, "id" | "name">[],
): ConfirmOptions | null {
    const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
    const gets = preview.filter((p) => p.create > 0).map((p) => `${name(p.providerId)} gets ${plural(p.create, "record")}`);
    const loses = preview.filter((p) => p.delete > 0).map((p) => `${name(p.providerId)} loses ${plural(p.delete, "record")}`);
    if (gets.length === 0 && loses.length === 0) return null;
    return {
        title: `Change the providers of ${siteName}?`,
        description: `${[...gets, ...loses].join(", ")}. It is written in the background, one record after another; a record is removed from a provider only once all the providers it goes to hold it.`,
        confirmLabel: "Save",
        variant: loses.length > 0 ? "danger" : "primary",
    };
}
