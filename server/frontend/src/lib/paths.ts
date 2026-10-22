import { generatePath } from "react-router-dom";

/**
 * Every path of the application, once. The routes take their `path`s from here, and
 * whatever navigates takes a pattern (no parameter) or one of the builders in `paths`
 * below. **No path literal anywhere else.**
 *
 * The patterns are absolute, also for a nested route: the tree says who is whose parent,
 * this says what the address bar shows.
 */
export const ROUTES = {
    login: "/login",
    // The dashboard: what needs a look, across every provider.
    root: "/",

    records: "/records",
    recordNew: "/records/new",
    record: "/records/:recordId",
    unmanaged: "/unmanaged",

    providers: "/providers",
    providerNew: "/providers/new",
    provider: "/providers/:providerId",
    providerEdit: "/providers/:providerId/edit",

    sites: "/sites",
    siteNew: "/sites/new",
    site: "/sites/:siteId",

    activity: "/activity",
    users: "/users",

    webhooks: "/webhooks",
    webhookNew: "/webhooks/new",
    webhook: "/webhooks/:webhookId",

    settings: "/settings",
} as const;

/**
 * The patterns with their parameters filled in. A pattern without one is used as it is.
 * `generatePath` encodes every parameter, so an id with a slash in it is passed as it is.
 */
export const paths = {
    record: (recordId: string) => generatePath(ROUTES.record, { recordId }),
    provider: (providerId: string) => generatePath(ROUTES.provider, { providerId }),
    providerEdit: (providerId: string) => generatePath(ROUTES.providerEdit, { providerId }),
    site: (siteId: string) => generatePath(ROUTES.site, { siteId }),
    webhook: (webhookId: string) => generatePath(ROUTES.webhook, { webhookId }),
};

/** The query parameter a list keeps its search in -- see `useSearchQueryParam`. */
export const SEARCH_PARAM = "search";

/**
 * The activity list with a search set, as a page about one thing opens it. The search is the
 * page's query and not a pattern of its own -- but a link that sets it must not spell it
 * out either.
 */
export const activitySearch = (search: string) => ({
    pathname: ROUTES.activity,
    search: `?${new URLSearchParams({ [SEARCH_PARAM]: search })}`,
});
