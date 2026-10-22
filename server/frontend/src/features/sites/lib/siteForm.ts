import type { Site, SiteInput } from "@dpm/shared";

/** The editor's fields, as typed. */
export interface SiteDraft {
    name: string;
    description: string;
    providerIds: string[];
}

export const EMPTY_SITE_DRAFT: SiteDraft = { name: "", description: "", providerIds: [] };

export const siteDraftFrom = (site: Site): SiteDraft => ({
    name: site.name,
    description: site.description,
    providerIds: site.providerIds,
});

export const siteInputFrom = (draft: SiteDraft): SiteInput => ({ ...draft });
