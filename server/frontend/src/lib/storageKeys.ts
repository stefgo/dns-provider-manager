/**
 * Every key the application writes to the browser's storage, once. **No key literal
 * anywhere else**: a key spelled in a component is one nobody finds again.
 *
 * A key reads `dpm.<area>.<what>`. `<area>` is the page or list that owns the value, so
 * the keys of one page sort together in the browser's storage panel; the prefix keeps
 * them apart from whatever else is served from the same origin.
 *
 * Renaming a key forgets what was stored under the old one. That is the whole cost --
 * every value here is a preference that is set again with one click -- so a rename needs
 * no migration.
 */
export const STORAGE_KEYS = {
    // The shell.
    theme: "dpm.app.theme",
    ui: "dpm.app.ui",
    /** Session storage: when the page last reloaded itself for a chunk that was gone. */
    chunkReloadAt: "dpm.app.chunkReloadAt",

    // Lists: table or cards.
    recordsView: "dpm.records.view",
    providersView: "dpm.providers.view",
    sitesView: "dpm.sites.view",
    unmanagedView: "dpm.unmanaged.view",
    activityView: "dpm.activity.view",
    usersView: "dpm.users.view",
    webhooksView: "dpm.webhooks.view",

    // Detail pages: whether the header's details are open.
    providerDetails: "dpm.providers.details",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
