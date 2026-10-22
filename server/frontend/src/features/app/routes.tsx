import type { RouteObject } from "react-router-dom";
import { Activity, Globe, Inbox, Layers, LayoutDashboard, Server, Settings as SettingsIcon, Users, Webhook } from "lucide-react";
import type { DashboardPage } from "@stefgo/react-ui-components";

import { ROUTES } from "../../lib/paths";
import type { TitleHandle, TitleSubject } from "../../lib/pageTitle";
import { RouteError } from "./RouteError";
import {
    ActivityView,
    DashboardOverview,
    ProviderEditorRoute,
    ProviderOverview,
    RecordEditorRoute,
    RecordOverview,
    SiteEditorRoute,
    SiteOverview,
    UnmanagedOverview,
    Settings,
    UserOverview,
    WebhookEditorRoute,
    WebhookOverview,
} from "./lazyPages";
import { NotFound } from "./routeElements";

type PageNav = NonNullable<DashboardPage["nav"]>;

/**
 * The part of a sidebar entry that is fixed: where it sits and what it is called. What
 * changes while the application runs -- the dot for unseen activity -- is added by
 * `AppLayout`, by `id`.
 */
export interface NavEntry extends Pick<PageNav, "label" | "icon" | "groupId" | "placement"> {
    id: string;
}

/**
 * What a route's `handle` may carry. The router types it as `any`; this is what is read.
 * `title` and `subject` are what the document title is made of -- see `lib/pageTitle.ts`.
 */
export interface RouteHandle extends TitleHandle {
    nav?: NavEntry;
}

const nav = (entry: NavEntry): RouteHandle => ({ nav: entry });

/** A route called by a fixed name: a form, mostly. */
const titled = (title: string): RouteHandle => ({ title });

/** A route about one thing, called by its name -- and by `title` until the name is known. */
const about = (subject: TitleSubject, title: string): RouteHandle => ({ subject, title });

/**
 * Everything inside the dashboard shell, as one tree. It is the only description of what
 * lives where:
 *
 * - **Paths** come from `lib/paths.ts`, each used here exactly once.
 * - **The sidebar** is the areas that carry `handle.nav`, in this order. An entry is
 *   marked while any route below its area is open -- nothing lists those routes again.
 * - **The document title** is the handles along the open route: the area's label, the
 *   `subject` a route is about, the `title` of a form.
 * - **Back** is the route above in this tree (`useBackPath`): an editor closes onto its
 *   list.
 * - **Not found and render errors** are the area's `errorElement`: the page is replaced,
 *   the shell around it stays.
 */
export const shellRoutes: RouteObject[] = [
    {
        path: ROUTES.root,
        handle: nav({ id: "dashboard", groupId: "overview", label: "Dashboard", icon: LayoutDashboard }),
        errorElement: <RouteError />,
        element: <DashboardOverview />,
    },
    {
        path: ROUTES.providers,
        handle: nav({ id: "providers", groupId: "dns", label: "Providers", icon: Server }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <ProviderOverview /> },
            { path: ROUTES.providerNew, handle: titled("New Provider"), element: <ProviderEditorRoute /> },
            { path: ROUTES.provider, handle: about("provider", "Provider"), element: <ProviderEditorRoute /> },
        ],
    },
    {
        path: ROUTES.unmanaged,
        handle: nav({ id: "unmanaged", groupId: "dns", label: "Unmanaged", icon: Inbox }),
        errorElement: <RouteError />,
        element: <UnmanagedOverview />,
    },
    {
        path: ROUTES.records,
        handle: nav({ id: "records", groupId: "dns", label: "Records", icon: Globe }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <RecordOverview /> },
            { path: ROUTES.recordNew, handle: titled("New Record"), element: <RecordEditorRoute /> },
            // By its kind: a record's name alone does not say which of several it is.
            { path: ROUTES.record, handle: titled("Record"), element: <RecordEditorRoute /> },
        ],
    },
    {
        path: ROUTES.sites,
        handle: nav({ id: "sites", groupId: "infrastructure", label: "Sites", icon: Layers }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <SiteOverview /> },
            { path: ROUTES.siteNew, handle: titled("New Site"), element: <SiteEditorRoute /> },
            { path: ROUTES.site, handle: about("site", "Site"), element: <SiteEditorRoute /> },
        ],
    },
    {
        path: ROUTES.activity,
        handle: nav({ id: "activity", groupId: "system", label: "Activity", icon: Activity }),
        errorElement: <RouteError />,
        element: <ActivityView />,
    },
    {
        path: ROUTES.users,
        handle: nav({ id: "users", groupId: "system", placement: "mobile-more", label: "Users", icon: Users }),
        errorElement: <RouteError />,
        element: <UserOverview />,
    },
    {
        path: ROUTES.webhooks,
        handle: nav({ id: "webhooks", groupId: "system", placement: "mobile-more", label: "Webhooks", icon: Webhook }),
        errorElement: <RouteError />,
        children: [
            { index: true, element: <WebhookOverview /> },
            { path: ROUTES.webhookNew, handle: titled("New Webhook"), element: <WebhookEditorRoute /> },
            // By its kind, not its name: the shell does not read the webhooks, and does not
            // start to for a title.
            { path: ROUTES.webhook, handle: titled("Webhook"), element: <WebhookEditorRoute /> },
        ],
    },
    {
        path: ROUTES.settings,
        handle: nav({ id: "settings", groupId: "system", placement: "mobile-more", label: "Settings", icon: SettingsIcon }),
        errorElement: <RouteError />,
        element: <Settings />,
    },
    { path: "*", handle: titled("Not Found"), element: <NotFound /> },
];

/** The sidebar entries, read off the tree: every area with a `handle.nav`, and its path. */
export const navEntries = shellRoutes.flatMap((route) => {
    const entry = (route.handle as RouteHandle | undefined)?.nav;
    return entry && route.path ? [{ ...entry, path: route.path }] : [];
});
