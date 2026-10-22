import type { AdoptResult, Provider, Site, UnmanagedEntry } from "@dpm/shared";
import { plural } from "../../../utils";

/** How the list and the server tell an entry apart: its provider and the provider's own id. */
export const entryKey = (entry: Pick<UnmanagedEntry, "providerId" | "externalId">) => `${entry.providerId}:${entry.externalId}`;

/** The entries the keys name, in the list's order. */
export const entriesOf = (entries: readonly UnmanagedEntry[], keys: ReadonlySet<string | number>) =>
    entries.filter((entry) => keys.has(entryKey(entry)));

/**
 * The sites the entries can be taken over into: those that write to every provider among
 * them. Taking an entry over means dpm writes it to that provider from now on, so a site
 * that does not reach it is no choice.
 */
export function adoptableSites<S extends Pick<Site, "providerIds">>(
    entries: readonly Pick<UnmanagedEntry, "providerId">[],
    sites: readonly S[],
): S[] {
    const providers = new Set(entries.map((e) => e.providerId));
    return sites.filter((site) => [...providers].every((id) => site.providerIds.includes(id)));
}

/** What a toast says after an adoption: how many were taken over, and every refusal with its reason. */
export function adoptOutcome(result: AdoptResult): { variant: "success" | "warning" | "error"; title: string; description?: string } {
    const merged = result.adopted.filter((a) => a.merged).length;
    const taken = result.adopted.length;
    const title =
        taken === 0
            ? "Nothing was adopted"
            : `${plural(taken, "record")} adopted${merged > 0 ? `, ${merged} of them as another site of an existing record` : ""}`;
    if (result.refused.length === 0) return { variant: "success", title };
    return {
        variant: taken === 0 ? "error" : "warning",
        title,
        description: result.refused.map((r) => `${[r.name, r.type, r.value].filter(Boolean).join(" ")}: ${r.reason}`).join("\n"),
    };
}

/**
 * The other providers of the site, by name, that dpm writes the adopted records to: a
 * record goes to every provider of its sites. One it only reads gets nothing.
 */
export function alsoWrittenTo(
    entries: readonly Pick<UnmanagedEntry, "providerId">[],
    site: Pick<Site, "providerIds"> | undefined,
    providers: readonly Pick<Provider, "id" | "name" | "writable">[],
): string[] {
    const from = new Set(entries.map((e) => e.providerId));
    return providers.filter((p) => site?.providerIds.includes(p.id) && !from.has(p.id) && p.writable).map((p) => p.name);
}
