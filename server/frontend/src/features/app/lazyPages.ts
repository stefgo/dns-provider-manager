import { lazy } from "react";

// Page components -- loaded on demand, so a chunk only arrives when its route does.
// A `.ts` file of its own: the route files next to it export route elements and the
// tree, and Fast Refresh wants a file to export components or other things, not both.
export const DashboardOverview = lazy(() =>
    import("../dashboard/components/DashboardOverview").then((m) => ({ default: m.DashboardOverview })),
);
export const ActivityView = lazy(() =>
    import("../activity/components/ActivityView").then((m) => ({ default: m.ActivityView })),
);
export const UserOverview = lazy(() =>
    import("../users/components/UserOverview").then((m) => ({ default: m.UserOverview })),
);
export const WebhookOverview = lazy(() =>
    import("../webhooks/components/WebhookOverview").then((m) => ({ default: m.WebhookOverview })),
);
export const WebhookEditorRoute = lazy(() =>
    import("../webhooks/components/WebhookEditor").then((m) => ({ default: m.WebhookEditorRoute })),
);
export const Settings = lazy(() => import("../../pages/Settings"));
