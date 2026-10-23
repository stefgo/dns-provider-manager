# 🖥️ Frontend Architecture

The frontend (`server/frontend`) is a **Single Page Application** built with React, Vite,
TypeScript and Tailwind CSS on the UI library `@stefgo/react-ui-components` (ruic). The
backend serves its build from `server/dist/public`.

## 📂 Project Structure

Code is grouped by feature: what belongs to one area of the application lives together.

```
src/
├── features/
│   ├── app/                              # Application shell
│   │   ├── App.tsx                       # The providers and the RouterProvider
│   │   ├── router.tsx                    # createBrowserRouter: /login, and the shell behind ProtectedRoute
│   │   ├── routes.tsx                    # The route tree: paths, sidebar entries, titles, error elements
│   │   ├── routeElements.tsx             # What the tree renders outside a feature: ProtectedRoute, NotFound
│   │   ├── lazyPages.ts                  # The page components, loaded on demand
│   │   ├── AppLayout.tsx                 # The dashboard shell: sidebar, badges, document title, outlet
│   │   ├── RouteError.tsx                # The errorElement of every area: not found, or what went wrong
│   │   ├── HeaderBreadcrumb.tsx          # The trail to the open page, as the heading of its first card
│   │   ├── context/                      # BreadcrumbContext, WebSocketContext and WebSocketProvider
│   │   └── lib/dashboardMessages.ts      # Parses a socket message against the contract; assertNever
│   ├── auth/                             # AuthContext and AuthProvider
│   ├── dashboard/                        # DashboardOverview, and the counts its cards show (lib/)
│   ├── records/                          # RecordOverview, RecordList, RecordEditor, RecordSiteSelect, RecordSitesDialog, the rules (lib/)
│   ├── providers/                        # ProviderOverview, ProviderList, ProviderDetail, ProviderEditor, the form rules and details (lib/)
│   ├── sites/                            # SiteOverview, SiteList, SiteEditor, SiteProviderSelect, form rules and siteDeletion (lib/)
│   ├── unmanaged/                        # UnmanagedOverview, AdoptDialog, the adoption rules (lib/)
│   ├── activity/                         # ActivityView, grouping, problem toasts
│   ├── users/                            # UserOverview, UserList, UserDialog
│   ├── webhooks/                         # WebhookOverview, WebhookEditor, the form rules (lib/)
│   └── settings/                         # The sections of the settings page
├── components/                           # Shared components: MultiSelectField, NotFoundCard, QueryError, RelativeTime, …
├── hooks/                                # useEntityForm, useUnsavedChangesGuard, useBackPath, useNow, …
├── lib/                                  # api, apiFetch, paths, pageTitle, breadcrumb, queryClient, queryKeys,
│                                         # cacheUpdates, storageKeys, notFound
├── queries/                              # The TanStack Query hooks, one module per area
├── stores/useUIStore.ts                  # What only this browser knows: the sidebar's state
├── pages/                                # Login, Settings
├── utils.ts                              # Dates, plurals, error messages
└── Main.tsx                              # Entry point
```

## 🚦 Routing & Navigation

Routing is a `react-router-dom` v7 data router (`createBrowserRouter` in `features/app/router.tsx`).
`/login` stands alone; everything else lives behind `ProtectedRoute`, which redirects
unauthenticated users to `/login`, inside `AppLayout`.

| Path                | Description                                                         |
| :------------------ | :------------------------------------------------------------------ |
| `/login`            | Authentication page (Local & OIDC).                                 |
| `/`                 | The `DashboardOverview`.                                            |
| `/records`          | The records (`RecordOverview`).                                     |
| `/records/new`, `/records/:recordId` | The `RecordEditor`.                                |
| `/unmanaged`        | What the providers hold and dpm does not manage (`UnmanagedOverview`). |
| `/providers`        | The providers (`ProviderOverview`).                                 |
| `/providers/:providerId` | One provider (`ProviderDetail`): its header with what the list has no room for. |
| `/providers/new`, `/providers/:providerId/edit` | The `ProviderEditor`.                   |
| `/sites`            | The sites (`SiteOverview`).                                         |
| `/sites/new`, `/sites/:siteId` | The `SiteEditor`.                                        |
| `/activity`         | The activity list.                                                  |
| `/users`            | User management.                                                    |
| `/webhooks`         | The webhooks events are reported to (`WebhookOverview`).            |
| `/webhooks/new`, `/webhooks/:webhookId` | The `WebhookEditor`, adding or editing one webhook.  |
| `/settings`         | System settings (retention and levels of the activity).             |

### One definition (`lib/paths.ts`, `features/app/routes.tsx`)

**Every path is written once**, in `lib/paths.ts`: `ROUTES` holds the patterns, `paths` the
builders that fill them (`paths.webhook(id)`), and `activitySearch` the address that carries
a query. No component spells a path; the routes take their `path` from `ROUTES`, and whatever
navigates takes a pattern or a builder.

**The tree in `routes.tsx` is the only description of what lives where.** An area is a
top-level route with its pages below it, and these are read off it:

- **The sidebar** is the areas that carry `handle.nav` (label, icon, group), in the tree's
  order. `AppLayout` adds what only the running application knows — the dot for unseen
  activity — and marks the entry of the innermost matched area, so an editor keeps its area
  marked without its path being listed anywhere. The groups are `overview`, `dns` (Providers, Sites,
  Unmanaged), `records` and `system`; `records` has no title, so only the gap above it sets
  Records apart from the providers that feed it.
- **The browser tab** names the open page (`lib/pageTitle.ts`): the handles along the open
  route, most specific first — `AdGuard 1 · Providers · DPM`. A route says `title` (a form, a
  record) or `subject` (a provider or a site, called by its name from the cached list, which
  `AppLayout` reads for this).
- **The breadcrumb** spells the same out as links (`lib/breadcrumb.ts`,
  `features/app/HeaderBreadcrumb.tsx`), as the heading of the page's first card. `AppLayout`
  computes the trail next to the title, from the same handles, and hands it down through
  `BreadcrumbContext`; a list has none.
- **Back** is the route above (`hooks/useBackPath`, `lib/backPath.ts`): the nearest match in
  the tree that is another place. The webhook editor closes onto the webhook list, with the
  list's `search` handed along and back.
- **Not found and render errors** are the area's `errorElement`, `RouteError`: the page is
  replaced, the shell around it stays, and the URL stays where it was. A route whose subject
  is gone for good throws `NotFoundError` (`lib/notFound.ts`).

A path no route claims reaches the catch-all and renders a **404 card** that names the path
and leads back to the dashboard.

**The pages are loaded on demand** (`React.lazy` in `lazyPages.ts`, with a `Suspense`
fallback around the outlet), so a chunk arrives with the route that needs it.

---

## 🔐 Authentication

Authentication is managed by the `AuthProvider` (`src/features/auth/AuthProvider.tsx`); components read it through `useAuth` from `AuthContext.ts`.

Each context is split the same way: the context object and its hook live in a JSX-free `.ts` module, the provider component in a `.tsx` file of its own. A module that exports a component next to a hook cannot be swapped by Vite's Fast Refresh, and `react-refresh/only-export-components` reports it as an error.

- **Session**: The JWT never reaches JavaScript. The server keeps it in the httpOnly cookie `dpm_session`, which the browser sends with every request and with the WebSocket handshake. The page only reads the flag cookie `dpm_auth`, which carries no secret, to decide whether to render the login form.
- **Provider**: The `AuthProvider` wraps the app and provides `isAuthenticated`, `user` (`{ id, username }` from `GET /api/v1/me`, `null` until it answers), `login()` and `logout()`. `logout()` clears the flag, calls `POST /api/auth/logout` to remove the httpOnly cookie, and returns to `/login`.
- **Login Flow**:
    1. **Local**: POST to `/api/login` → the server sets the cookies → `login()`.
    2. **OIDC**: Redirect to `/api/auth/login` → provider callback with code → the backend exchanges the code, sets the cookies and redirects to `/`. Nothing is passed in the URL.
- **Stale flag**: The flag can outlive the session (a restarted server with a new `jwtSecret`, an expired token). The first request, `/api/v1/me`, then answers `401` and `apiFetch` logs out.
- **API calls**: Every request to an authenticated endpoint goes through `apiFetch` (`src/lib/apiFetch.ts`). It sends the request with `credentials: "same-origin"`, so the session cookie goes along, and reacts to `401` in one place: it calls the `logout` the `AuthProvider` registered with `setUnauthorizedHandler` and throws `SessionExpiredError`, so the router lands on `/login`. Queries and components therefore take no token parameter. `Login.tsx` and the logout use `publicApi` on purpose — `/api/login`, `/api/auth/logout` and `/api/auth/config` are unauthenticated, and a wrong password must produce an error message, not a logout. Logging out clears the query cache: what it holds was read for the user who is leaving.
- **Expiry**: Besides the `401` handling, the `AuthProvider` logs out at the `expiresAt` that `/api/v1/me` reports, because a dashboard fed only by the WebSocket may not send a request for a long time.
- **Login UI**: The `Login.tsx` page uses the pre-built `LoginPage` component from `@stefgo/react-ui-components`, configured with app title, auth type, and handler callbacks.

---

## 🗂️ State Management

Two kinds of state, kept apart.

**What the server holds** lives in one **TanStack Query** cache (`lib/queryClient.ts`), read through the modules in `queries/`. **What only this browser knows** lives in **Zustand**: `useUIStore`, the sidebar's collapse state, saved to `localStorage` by the `persist` middleware (`STORAGE_KEYS.ui`). It is the only store.

**Storage keys.** That key, the theme's and those of every list's view settings are named in `lib/storageKeys.ts` and nowhere else, as `dpm.<area>.<what>`; a test holds them unique and in that form. The keys were renamed when they moved there, and the old values are not carried over: after the update a browser shows the default theme, an open sidebar and every list in its default view once, until the reader chooses again.

### The API client (`lib/api.ts`)

Every request goes through `api.get`, `api.post`, `api.put`, `api.patch` or `api.delete`, and nothing else reads a response body.

- **Every call names the schema its answer has to match** (`shared/src/responses.ts`) and gets back what that schema parsed. An answer that does not match throws; the issues go to the console, because they name fields.
- **A refusal throws an `ApiError`** with the server's own `error` text and the HTTP status. A caller passes a `fallback` for a body that carries none.
- **`publicApi`** is the same client for `/api/login`, `/api/auth/logout` and `/api/auth/config`, where a `401` is a wrong password and not an expired session.

`apiFetch` stays below it and is called by nothing else.

### Queries (`queries/`)

| Module | Holds | Kept current by |
| :-- | :-- | :-- |
| `activity.ts` | The activity list as the server reads it for the session's user, so `seen` needs no user id on this side. Marking seen and deleting all are optimistic. `useUnseenTone` gives the badge its colour as a string, so the shell re-renders only when that changes. | `ACTIVITY_UPDATE`, `ACTIVITY_APPENDED`, `ACTIVITY_SEEN` |
| `scheduler.ts` | The status of the schedulers the server runs (`notification-cleanup`). | `SCHEDULER_STATUS_UPDATE` |
| `records.ts`, `sites.ts`, `providers.ts` | Their lists. They name each other — a site counts its records and lists its providers — so a change to one is read back into all of them and the unmanaged list (`invalidateDns` in `queries/dns.ts`). `providers.ts` also has the connection test and "Read now"; `records.ts` the editor's preview, the pending removals and the actions at a provider (`useRecordAction`); `sites.ts` the preview of a site's providers. | `READINGS_UPDATE` (providers), `RECORDS_UPDATE` (records) |
| `unmanaged.ts` | What the providers hold and dpm does not manage, with each provider's reading; adopting. | `READINGS_UPDATE`, `RECORDS_UPDATE` |
| `webhooks.ts`, `users.ts` | Their lists. Nothing broadcasts a change, so they go stale by age (30 s) and are read again after a change made here. | — |
| `settings.ts` | No entry: the requests of the settings page. | — |

The entries a message keeps current never go stale by age (`staleTime: Infinity`). The settings form is deliberately not a cache entry: one that is read again behind the form would overwrite what is typed and not yet saved.

**How an entry changes is a pure function** in `lib/cacheUpdates.ts`, tested without a socket or a component: `appendActivity`, `markActivitySeen`, `unmarkActivitySeen` and `applySchedulerUpdate`.

**A push and a request race on every page load**, and the rules say which one stays. The stores used to let whichever arrived later win, so an answer read before a change could cover the push that reported it.

- **A list the socket delivers whole** (the activity) carries no stamp to compare. `readUnlessPushed` (`lib/queryClient.ts`) keeps what the socket wrote while the request was under way: that is at least as new as what the request read.
- **A message that carries a part** (`ACTIVITY_APPENDED`, `ACTIVITY_SEEN`, `SCHEDULER_STATUS_UPDATE`) changes an entry that is there and makes none: the part alone would pass for the whole.

**A page says when its data could not be read.** `components/QueryError.tsx` shows what failed and the server's reason, instead of the list: an empty list says there is nothing, which is another statement. The hooks hand out an `error` only while there is no data, so a reload that fails behind a list on screen leaves the list there.

### Real-time Updates (WebSocket)

The `WebSocketProvider` (`src/features/app/context/WebSocketProvider.tsx`) maintains a persistent WebSocket connection to the backend (`ws://.../ws/dashboard`), authenticated by the session cookie the browser sends with the handshake.

**The messages are a contract in `@dpm/shared`.** `DashboardMessageSchema` (`shared/src/dashboardMessages.ts`) lists every message the server sends a dashboard as one discriminated union; the backend's senders take that type, and the provider parses each message against the schema (`features/app/lib/dashboardMessages.ts`). What does not match is dropped and reported once per type. The dispatch is a `switch` that ends in `assertNever`, so a message type without a case fails `typecheck`.

| Event                  | What it does to the cache                        |
| :--------------------- | :----------------------------------------------- |
| `ACTIVITY_UPDATE`      | Replaces the activity list                       |
| `ACTIVITY_APPENDED`    | `appendActivity` — merges new events by id, newest first |
| `ACTIVITY_SEEN`        | `markActivitySeen` — marks the ids seen, also from another tab |
| `SCHEDULER_STATUS_UPDATE` | `applySchedulerUpdate` — one scheduler, where the status has been read |
| `READINGS_UPDATE`      | Reads the providers and the unmanaged list again |
| `RECORDS_UPDATE`       | Reads the records (and their removals) and the unmanaged list again |

On connect the server sends the activity list by itself.

**A lost connection is said.** The dashboard does not poll, so without the socket the page shows a snapshot. Five seconds after the socket is gone (`isLost` in `WebSocketContext`, `LOST_AFTER_MS` in the provider) the layout shows the library's `ConnectionBanner` through the `banner` prop of `Dashboard` and wraps the page in `StatusDotProvider live={false}`, which stops every status dot from pulsing. The delay keeps a server restart from flashing the banner. The reconnect itself stays at a fixed 3 seconds. After a reconnect, everything the server does not send again by itself (`isPushedOnConnect` in `lib/queryKeys.ts`) is invalidated: what is on screen is read again, the rest when it is next shown.

---

## 🧩 Feature Details

### Lists (`DataMultiView`)

Every list is one `DataMultiView`, and its columns are described **once**, as a
`DataColumnDef[]` passed as `columns`: the heading is also the list label, and one `render`
serves the table and the list. A column that belongs to one view only says so
(`table: false`, `list: false`), and the rare cell that has to differ reads the `view` its
`render` is given. The actions come from `actionsColumn`, the list's two blocks from
`listGroups` — both the library's. `sort.defaultValue` counts table columns, so a column
with `table: false` has no index.

`ActivityView` is the exception: it is a table on every screen, so it keeps a `tableDef`.
A `columns` array would give it a list view.

A list with nothing in it shows the library's `EmptyState` as its `emptyMessage` — an icon,
what is missing, and what makes entries appear. A search without a hit is a different
message, `noResultsMessage`: "No webhooks match …" must not read like a list nobody has added
to yet. The view can only tell the two apart when it does the filtering, so a list passes
all of its rows as `data` and its match function as `searchFilter`; rows filtered in front
of the view look like an empty list to it. A filter that is not the search — the activity's
level and seen state — is applied in front, and the list words its `emptyMessage` for it.

### Dates and times (`utils.ts`, `components/RelativeTime.tsx`)

`formatDate` and `formatTime` write a date the way **the browser's locale** does; no locale
is fixed in the code. Both take a `locale` for a caller that must not depend on where it
runs, which is what the tests pass.

Where the question is "how recent", the date is written as its distance from now:
`<RelativeTime date={…} />` shows `just now`, `5 min ago`, `2 h ago`, `3 d ago`
(`formatRelative`), and the date itself in the tooltip. Past thirty days, and for a date
that lies ahead, it writes the date. It reads `useNow`, the page's one clock, so the text
moves on every 30 seconds without anything else re-rendering the row. Used for the time of an
activity entry, and for when a provider was last read. A date that is a fact rather than a
distance — a user's creation, a scheduler's next run — stays a date.

### LoadingIndicator (UI library)

"Something is on its way", for a view with nothing to show yet — a lazy route, the settings loading. `role="status"` announces the label when it appears; the spinner is decorative.

### StatusDot (UI library)

The dot that says whether something is in order right now — such as whether a provider answers.

It is the library's `StatusDot` and takes a `tone`, not a status of the application's: the caller maps its own word onto a role (`success`, `warning`, `error`, `neutral`), the appearance belongs to the component. Without a `label` the dot is `aria-hidden`, since every place that shows it also names the state in text.

`AppLayout` wraps the dashboard in `StatusDotProvider` with `live` bound to the WebSocket's `isLost`: a pulse says "this is happening now", and once the socket has been gone for five seconds no dot pulses. The same flag shows the `ConnectionBanner`.

### Forms (`hooks/useEntityForm`, `hooks/useUnsavedChangesGuard`)

Every editor keeps the same three things: a draft, what it was when it was opened or last saved, and how the save went. `useEntityForm` holds them; each editor used to build them by hand.

- **Checked before it is sent.** The draft is turned into the request (`toInput`) and parsed with **the schema the backend parses that request with** -- `WebhookInputSchema`, `CreateUserSchema`. An issue is shown at its field (`fieldOf` maps a request key to a draft field); what belongs to no field is `formError`. `rules` adds what only the form knows.
- **Errors appear with the first change.** A form that was just opened has a disabled Save because there is nothing to save, not because a field is wrong.
- **The rules are pure.** `lib/entityForm.ts` and the `lib/*Form.ts` module of a feature (`userForm`, `webhookForm`) hold them apart from React, where the tests reach them.

`useUnsavedChangesGuard(isDirty, editor)` is the one place unsaved work is asked about. Every way out of a page goes through the router's blocker -- the close button, Cancel, Escape, an entry in the sidebar, the browser's back button -- so they all ask the same question (`describeDiscardChanges` in `components/confirmations.ts`). The editors used to ask only for their own close button and Escape; a click in the sidebar dropped the edits without a word. A reload or a closed tab is not a navigation the router sees, and gets the browser's own prompt (`beforeunload`). The blocker is why the routes run on a data router.

It returns `close` (leave for the parent in the route tree, asked about while dirty) and `leave` (the same without the question, for the navigation that follows a save).

| Surface | Form | Guard |
| :-- | :-- | :-- |
| `WebhookEditor` | `useEntityForm`, `webhookForm.ts` | yes |
| `UserDialog` | `useEntityForm`, `userForm.ts` | no: a modal, not a route |
| `Settings` | its own draft per section, checked by `sectionError` | yes, while any section is unsaved |

### Dialogs

`Modal` from `@stefgo/react-ui-components` is what a dialog is built from. The three hand-built overlays that preceded it (`fixed inset-0 bg-black/80 …`) had no focus trap, no Escape, no scroll lock and no focus return.

- `UserDialog` turns `closeOnOverlayClick` off: it holds unsaved input, and a stray click beside it should not discard the work.

Editors that live in the workspace rather than in a dialog leave through `useUnsavedChangesGuard`, which also handles their `Escape` — see [Forms](#forms-hooksuseentityform-hooksuseunsavedchangesguard).

### Confirmations

Every question before an action, and every notice after a failed one, goes through `useConfirm()` from the library. `ConfirmProvider` sits next to `ToastProvider` in `App.tsx` and renders the one dialog that answers; no component keeps a pending request, a busy flag or a `ConfirmDialog` of its own, and no component calls `window.alert` or `window.confirm`.

- `confirm(options)` resolves `true` or `false`. An action that is quick to hand off — a pull, a discard — runs after the `await`.
- An action whose outcome is worth waiting for — a delete — goes in `onConfirm`. The dialog stays open and busy until it settles; a rejection keeps it open with the error inside it, next to the button that retries. That is why a delete is passed as `mutateAsync`, which rejects, rather than reporting the failure itself.
- `alert(describeFailure(title, error))` from `utils.ts` reports a failure of an action that was not asked about first, such as the cleanups in Settings.

**The texts live in a `confirmations.ts` per feature** (`activity`, `users`, `webhooks`), one `describeX(...)` per action, returning the complete options including `variant`. The one question every editor shares — "Discard your changes?" — lives in `components/confirmations.ts`, with one consequence line per editor. A component decides *that* it asks, never *what* the question says or whether it is `danger`. The reasoning behind a wording — what an action really does, what stays where it was — is kept as a comment on its function.

### Records, Providers and Sites (`features/records`, `features/providers`, `features/sites`)

Each is a list and an editor on a page of its own, built like the webhooks: the list is a
`DataMultiView`, the editor holds its draft in `useEntityForm`, checked against the schema the
server parses with (`RecordInputSchema`, `ProviderInputSchema`, `SiteInputSchema`), and leaves
through `useUnsavedChangesGuard`. The rules of each form are pure (`lib/recordForm.ts`,
`lib/providerForm.ts`, `lib/siteForm.ts`) and tested.

- **Records** are ordered by name, so the records of one name stand together — round robin,
  and split horizon across sites. TTL and Cloudflare's proxy are set per provider, in the
  provider's line of `RecordProviders`, as far as its type knows them (`PROVIDER_CAPABILITIES`
  in `@dpm/shared`); the draft keeps only settings that differ from the defaults
  (`withSetting`). The lines stay one list while the preview catches up, so a field being typed
  into is not replaced. A conflict with another record is
  the server's to find (`recordConflict` in `@dpm/shared`) and is shown above the form.
- **Where a record stands** is one `Badge` in the list, the most urgent state at any of
  its providers (`ProviderStatus`, `overallState`, tone and words in `lib/recordSync.ts`); its
  tooltip lists each provider. The list filters by site (a site, or *Parked*) and by that
  state (*In sync*, *Problems*, *Work in Progress*) — `lib/recordFilters.ts`, pure and tested.
  They are filters of their own, not the search, so an empty list says that nothing is in that
  state; like the search they are kept in the address (`RECORD_FILTER_PARAM`) and come back
  when the editor closes. The "Problems" button is a shortcut for that state. In the editor,
  `RecordProviders` lists the same with *Write again* and *Take over* for drift, and while the
  draft differs from what is stored, the server's preview of what saving does — asked once
  typing pauses (`useDebouncedValue`, by the request's text). A save that removes the record
  from a provider, a deletion, and a site whose providers change ask first, with what the
  server's preview says. What the actions at a provider ask and report is `useLinkActions`;
  a save that a provider did not take is a toast, the record is stored all the same. Deleted
  records a provider still holds are an `Alert` above the list. Picked records get or lose
  sites together with "Change Sites" (`RecordSitesDialog`): each site's box starts ticked,
  empty or half as all, none or some of them have it, only a changed box changes the records,
  and the dialog says which providers get or lose records and which are parked
  (`lib/bulkSites.ts`). The outcome is one toast with every refusal, as for an adoption.
- **Providers** have one draft for every type, so switching the type of a new provider keeps
  what was typed in the fields they share; `providerInputFrom` sends only the type's own. The
  secret field is empty, never filled with the stored value, and saves nothing until something
  is typed; after a save it is empty again (`rebase`). A stored provider keeps its type.
- **Providers** list how their last reading went, how many records go to each and how many
  of them need a look (`lib/providerRecords.ts`), and a badge for one dpm only reads. The editor tests a provider as it stands in
  the form ("Test Connection", the stored secret standing in for an empty field), and lists a
  Cloudflare provider's zones with who uses each; under "Selected zones" they can be ticked.
- **Unmanaged** lists what the providers hold and dpm does not manage there, with the reason
  where an entry cannot be adopted. An entry is adopted from its row, the picked ones
  together with "Adopt", which waits for a pick, into a site that writes to their provider
  (`adoptableSites` in `lib/adopt.ts`); the dialog names the site's other providers the
  records are written to (`alsoWrittenTo`), and the outcome is one toast with every refusal.
  The sidebar entry counts the entries.
- **Sites** choose their providers; saving a changed choice asks first with how many records
  each provider gets or loses (`lib/siteSync.ts`). Which sites a provider belongs to is set here, not in the
  provider editor. A site that a record belongs to alone is not offered for deletion: a notice
  names the records first (`lib/siteDeletion.ts`).

### DashboardOverview (`features/dashboard`)

The landing page: what needs a look. For now one card, **Errors / Warnings**, counts the
unseen activity rows at warning and above (`unseenProblems` in `lib/dashboard.ts`, grouped
the way the activity list groups them) and opens the activity beneath it. The open list is
kept in the `panel` query parameter. The cards for records, providers and sites join it as
those areas arrive.

### ActivityView (`features/activity`)

The page at `/activity`. Its entries are structured events: a `kind`, a `level`, what the
event is about and the facts of that kind.

**The text is written in one place.** `activityText.ts` in `@dpm/shared` is the one place a
wording exists — the webhooks send the same sentence as `{{event.message}}`. An event carries
its facts and no sentence, so a wording can be changed without touching what is stored, and
the level filter works on `level` rather than on a search through prose. A kind this build
does not know still gets a row — the fallback prints the kind itself.

**Rows are groups.** `groupActivity.ts` folds the flat list by `correlationId`: the events of
one operation become one row with expandable steps (`ActivityGroupSteps`, with an `N steps`
badge); every other event is a row of its own. A kind listed in `GROUP_HEADS` heads its group
wherever it sits; without one, the earliest member does. The row carries the most severe
level in the group, so an operation whose last step failed does not read as an untroubled
one. Grouping is a lookup, not a guess — whoever caused the group put its id on every member.

**The level filter is a minimum**, and its label says so: `≥ info`. It sits at the right end of the search bar (`searchActions`)
and opens on what needs a look: `error` while an error is unseen, else `warning` while a
warning is, else `info` — the same rule as the sidebar badge. The start is fixed once the list
is known, so marking rows seen does not move the filter. `trace` events are hidden until
`trace` is chosen.

**A second filter hides what has been seen.** Next to the level filter, `Show: all` /
`Show: unseen` switches between the whole list and the rows with something unseen in them;
under `unseen` a row leaves the list once it is marked seen. It starts at `unseen`.

**"Mark as seen" follows the filter.** It marks the unseen events of every row the level
filter and the search leave, across all pages, and nothing the reader has not been shown.

**A new problem is reported on whatever page is open.** `useProblemToasts`, mounted in
`AppLayout`, raises a toast for an error or a warning that joins the list while the
dashboard is open, with the sentence the list shows. The list as it first arrives is what
was there before; no clock decides what is new. An error stays until it is dismissed, a
group is reported once (by its `correlationId`), and more than three at a time are
counted in one toast (`lib/problemToasts.ts`).

**Entries are not deleted one by one.** A row can be marked seen; the history goes as a whole
("Delete all") or through retention.

Everything else is found through the search box, as on the other lists (`useSearchQueryParam`,
so the query survives a reload). It matches the sentence a row shows, its detail line and the
`kind`, which is also shown as a chip under the line. A group matches when
any of its events does, so a step is found under the operation it belongs to. The sidebar
badge counts single unseen events, not groups.

### UserOverview (`features/users`)

Manages user accounts. Supports creating, editing, and deleting users via a `UserDialog` form, checked against `CreateUserSchema`; that a local account needs a password is said at the password field. Deleting asks first; the dialog states that a session the account already holds stays valid until it expires, because the API checks only the JWT. For the last remaining user a second dialog explains why it cannot be deleted instead of sending the request. `UserList` is a `DataMultiView` like every other list: search by username, a list view for narrow screens, pagination.

### WebhookOverview & WebhookEditor (`features/webhooks`)

Its own entry in the sidebar, in the System group above Settings. `WebhookList` is a
`DataMultiView` like every other list — search over name and URL, table and list view — and
shows per webhook its target, its filters and how the last delivery ended, with the reason
of a failure. A row, or its Edit action, opens the editor; Delete asks first.

**The editor is a page, not a dialog**, at `/webhooks/new` and `/webhooks/:webhookId`. It
leaves the way every editor does: every way out asks first when there are unsaved
edits and leads back to the list (`useUnsavedChangesGuard`); Save goes back after storing.
The draft is checked against `WebhookInputSchema`: each field says what it lacks, a header
line that is not `Name: value` is reported at the headers, and Save and "Send Test" stay off
until the draft is one the server takes. The webhook is read from
`GET /api/v1/webhooks`; an id that is not there throws `NotFoundError`. The preview is
rendered with `renderTemplate` from `@dpm/shared` — the code the server sends with — against
the sample event for the draft's kinds (`sampleWebhookRecord`, the one "Send Test" sends; its
kind is named above the preview), so the preview and the delivery cannot disagree. "Send Test" posts the
unsaved draft to `/api/v1/webhooks/test`. See [Webhooks](webhooks.md) for the template syntax.

### Settings (`pages/Settings.tsx`, `features/settings`)

System settings page, one section per tab — today only Activity History. The tabs are the library's `useTabs`/`TabList`/`TabPanel` with a `SideTab` per section, the sections are built from its `SectionHeader` and `NumberField`, and the open tab is kept in the URL (`?tab=`). The sections live in `features/settings/components`; `features/settings/sections.ts` names the keys each one edits.

**Every section saves on its own.** Its Save sends only its own keys, and `PUT /api/v1/settings/cleanup` merges them into the stored block, so a section never writes over edits in another one. A tab with unsaved edits carries a dot, and leaving the page asks first for as long as any section has some; switching tabs is not leaving. A value the server would refuse is named beside Save before anything is sent (`sectionError`, against `CleanupSettingsSchema`). The manual maintenance runs act on the saved values, not on unsaved edits.

**Every tab follows one layout:** its settings, then one `SchedulerBox` headed "Scheduler". It shows Status (`Running…` or `Idle`), Last Run (with "manual" when a user started it), Next Run (or "Disabled") and Result, and, below a divider, the `ManualRun` row with its Run Now button. The box draws no field borders: its values are to read, not to edit. It reads `useSchedulerStatus`; the result is worded by `describeRunResult` (`features/settings/lib/runResult.ts`), in red for a failed or interrupted run. The settings page uses no monospaced type.

| Setting                                      | Description                                                                   |
| :------------------------------------------- | :---------------------------------------------------------------------------- |
| `notification_retention_days`                | Days to keep activity events.                                                 |
| `notification_retention_count`               | Minimum number of the newest activity events always kept.                     |
| `notification_cleanup_interval_hours`        | Automatic activity cleanup interval. `0` disables.                            |
| `activity_level_overrides`                   | The level each event kind is recorded with, or `none`. One string; the Activity History tab edits it through one select per kind (`features/settings/lib/eventLevels.ts`), and "Default" names the level from `ACTIVITY_DEFAULT_LEVELS`. |

- `GET/PUT /api/v1/settings/cleanup` — Fetch and save settings.
- `POST /api/v1/settings/cleanup/notifications` — Manually run the activity cleanup.
- `GET /api/v1/settings/scheduler-status` — Status, last and next run of the scheduler.

---

## 🎨 Styling & Theming

- **Tech Stack**: Tailwind CSS v3 with the `@stefgo/react-ui-components/tailwind-preset` as the base configuration.
- **Dark Mode**: Supported via the `class` strategy. The `dark` class is applied to the `<html>` tag, controlled by the library's `ThemeProvider`, which `App` mounts with `STORAGE_KEYS.theme`; `useTheme()` comes from the library as well. **A colour is one class, not two:** `bg-card` resolves per theme because the preset redefines the custom property behind it in its `.dark` block. The `…-dark` twins (`dark:bg-card-dark`) are gone with library 3.0, and the preset sets `darkMode` itself.
- **UI Library**: All generic components (Buttons, Inputs, Cards, Dashboard shell, etc.) come from `@stefgo/react-ui-components`. Domain-specific components live in `src/features/`.
- **Colours are roles, not palette values**: `bg-success`, `text-error`, `text-warning`, `text-info`, `bg-error-bg`. The library decides once what a role looks like in either theme, so a status dot cannot be a different green from one view to the next. Status pills are the `Badge` component.
- **Custom Tailwind Extensions**: the font family **Inter**, and nothing else. The font ships with the bundle (`@fontsource-variable/inter`, imported in `Main.tsx`), so opening the application makes no request to another origin, and the server's CSP names none. The former `app.text-footer` (`#444444`) only existed to stay readable on a white panel, and `shadow-glow-online` was a fixed green; the online dot uses `shadow-glow-success`, which the preset derives from the success token.
- **Tailwind Integration**: Tailwind merges `darkMode` and `safelist` from the preset, but **not** `content`: a `content` array in the app's config replaces the preset's rather than extending it. The library's own glob is therefore spread back in, or every class only the library uses is missing from the output:

```javascript
content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", ...preset.content, ...localUiContent],
```

### Working against a local checkout of the UI library

By default Vite, Tailwind and the type check all use the **installed** `@stefgo/react-ui-components` (pinned in `server/frontend/package.json`). A build must not depend on a sibling checkout that CI and the Docker build do not have.

To develop the library and the app together, set `VITE_USE_LOCAL_UI=true` in the shell (optionally `VITE_UI_COMPONENTS_PATH`, default `../../../react-ui-components` relative to `server/frontend`):

| Tool | Installed package (default) | `VITE_USE_LOCAL_UI=true` |
| :--- | :--- | :--- |
| Vite | resolves the package from `node_modules` | aliases the import to `<path>/src/index.ts` |
| Tailwind | preset and `content` glob from the package | loads the checkout's `tailwind-preset.js` and scans `<path>/src/**/*.{ts,tsx}` |
| Type check | `npm run typecheck -w server/frontend` | `npm run typecheck:local-ui -w server/frontend` (`tsconfig.local-ui.json`) |

Always switch all three together; otherwise the compiler checks one version of the library while Vite bundles another. Tailwind swaps the preset with the glob, because the preset carries the theme — on the installed preset a local build would run new components on the old theme. `tsconfig.local-ui.json` cannot read environment variables and uses the default path. `compose.dev.yaml` already sets `VITE_USE_LOCAL_UI=true` for the dev container.

---

## 📦 UI Library (`@stefgo/react-ui-components`)

The app is heavily integrated with `@stefgo/react-ui-components`, pinned to an exact version (4.7.0). Components used:

| Component / Type       | Usage                                                     |
| :--------------------- | :-------------------------------------------------------- |
| `Dashboard`            | App shell with sidebar, user menu, theme toggle. Renders navigation; the pages come from the app's routes as `children`. |
| `DashboardPage`        | Type for a navigation entry (`{ id, path, nav }`).        |
| `LoginPage`            | Pre-built login form UI (local & OIDC).                   |
| `Card`                 | Generic surface card. `padding="none"` for a card that holds a table. |
| `StatCard`             | Stat tile — the dashboard numbers (clickable, opening their list or page). |
| `Input`                | Form input field.                                         |
| `Button`               | Button with variants (primary, secondary, danger).        |
| `DataTable`            | Table view with sorting and paging.                       |
| `DataMultiView`        | Switches between table, list and tree views for data.     |
| `DataColumnDef`        | One column for table and list alike; with `actionsColumn` and `listGroups`. |
| `DataTableDef`         | Column definitions for a view that is a table only (`ActivityView`, the counters). |
| `EmptyState`           | An empty list: icon, what is missing, what fills it.      |
| `DataAction`           | Typed action descriptors for data row operations.         |
| `ActionMenu`           | Context ("kebab") menu for per-item actions.              |
| `MenuItem`             | One entry of a detail page's `ActionMenu`: icon, label, `variant="danger"` for an entry that destroys something. It closes the menu itself. |
| `useActionMenu`        | Hook for `ActionMenu` state; supplies the trigger's `anchor`. |
| `useTabs` / `TabList` / `TabPanel` | The settings page's sections. See below. |
| `Modal`                | The base every dialog is built from — focus trap, Escape, scroll lock, focus return. |
| `Select`               | Dropdown in the forms.                                    |
| `useToast` / `ToastProvider` | Transient result messages raised from the shell.     |
| `cn`                   | Class-name join; the app uses it where it draws a surface itself. |
| `ConfirmProvider` / `useConfirm` | Every confirmation and failure notice. See [Confirmations](#confirmations). |
| `Badge`                | Status pill in one of five roles (`success`, `warning`, `error`, `info`, `neutral`). |
| `SideTab` / `SectionHeader` / `NumberField` / `ManualRun` | What the settings page is made of: a tab of the side list, a section's heading, a whole-number field clamped to its minimum, and "run the job now". |
| `Alert`                | The box a refused save and the result of a webhook test are shown in. An error is `role="alert"`, every other tone `role="status"`. |
| `FieldLabel`           | The caption of a stacked field, for something that is no library control: a read-only value, a switch. |
| `CopyField`            | A value to take away next to the button that copies it. |
| `ThemeProvider` / `useTheme` | Which theme is on, the class on `<html>` and the stored choice. |
| `StatusDot` / `StatusDotProvider` / `LoadingIndicator` | See [StatusDot](#statusdot-ui-library) and [LoadingIndicator](#loadingindicator-ui-library). |
| `Checkbox`             | Checkbox with label, `indeterminate` for a partial selection.  |
| `ActionButton`         | Round icon button with a tooltip — close, copy, expand, kebab.  |
| `EntityHeader`         | Header of a page about one thing: title, badges, actions, and details that open on request. |
| `FOCUS_RING` / `FOCUS_RING_INSET` / `FOCUS_RING_NONE` | The focus ring for the few surfaces the app still draws itself: an inline chip, a tab, a menu entry. Every library component brings its own. |

**The data views own sorting and paging.** A view receives the complete set in `data` and takes the page *after* sorting, which is what makes a column sort cover every row instead of the ten on screen. The page state lives in the view, configured through the library's `listPagination(PAGE_SIZE.…)` — 20 rows for a list that is a page of its own, 10 for one inside a tab; `usePagination` is only for holding it outside, and the app does not need it. Sorting, search and view mode follow the same shape: `sort={{ defaultValue: [...] }}`, `search={{ value, onChange }}`, `viewMode={{ persist: { key, scope: "local" } }}` — the persistence vocabulary that replaced the bare `storageKey` in library 4.0; `scope: "local"` is what `storageKey` did, so a chosen view mode survived the move.

**The tabs are the library's.** The settings page drives its section list and the panels beside it from one `useTabs({ tabs, value, onChange, orientation: "vertical" })`: it supplies the roles, the tab-to-panel wiring, the roving tabindex and the arrow keys. `TabPanel` keeps a panel that has been opened once mounted (`visited`), so unsaved edits survive a switch away and back. The active tab itself is a URL parameter, so a reload and a shared link land on the same tab.
