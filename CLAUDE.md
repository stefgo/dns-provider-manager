# DNS Provider Manager — CLAUDE.md

## Project Overview

A monorepo for keeping DNS records (A, AAAA, CNAME) in one place and writing them to several
DNS providers — Cloudflare, AdGuard Home and Samba AD. Abbreviated **dpm**. Consists of:
- **server/backend** — Fastify API server: the records, the sites, the providers, and the
  connections to them
- **server/frontend** — React SPA
- **shared** — Common TypeScript types, Zod schemas, constants

Built from keepalived-status-monitor (kasm), whose stack and conventions it keeps. **There is
no agent**: every provider is reached over the network by the server itself — Cloudflare
over its HTTPS API, AdGuard Home over its HTTP API, Samba AD over LDAPS. The implementation
plan with its milestones is `plans/implementation-plan.md` (not committed).

### Terms

- **Provider** — one configured connection: a Cloudflare API token, an AdGuard Home
  instance, a Samba AD domain. Several Cloudflare accounts are several providers.
- **Site** — a group of providers that give the same answers (`internal`, `external`). A
  record belongs to one or more sites. Not to be confused with the sites of an Active
  Directory, which dpm neither shows nor names.
- **Zone** — a DNS zone at a provider. A zone is used by at most one provider.
- **Record** — the central record dpm manages. What a provider holds and dpm does not manage
  is **unmanaged** and is never changed.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22+, Fastify 5, SQLite (better-sqlite3), Pino |
| Frontend | React 19, Vite 7, TanStack Query 5, Zustand, Tailwind CSS 3, React Router 7 |
| Shared | TypeScript, Zod 4 |
| Auth | JWT + optional OIDC |
| DB Migrations | Umzug |
| UI Components | @stefgo/react-ui-components |
| Icons | lucide-react |

## Monorepo Structure

```
dns-provider-manager/
├── shared/              # Types, Zod schemas, constants
├── server/
│   ├── backend/         # Fastify REST + WebSocket API
│   └── frontend/        # React SPA (Vite)
├── docs/                # Documentation, published to GitHub Pages (mkdocs.yml)
├── docker/              # Dockerfiles
├── plans/               # Implementation plans (git-ignored)
├── compose.yaml         # Production Docker Compose
└── compose.dev.yaml     # Dev stack: the server in watch mode, two AdGuard Home instances
```

## Development Commands

```bash
# Root-level
npm run dev:server       # Backend in watch mode
npm run dev:frontend     # Frontend dev server (Vite)
npm run build            # Build all workspaces
npm run clean            # Clean build artifacts
npm run lint             # ESLint over shared and server/backend
npm run lint:frontend    # ESLint over server/frontend (its own config)
npm test                 # Vitest over shared, the frontend and the backend, once
npm run test:watch       # Vitest, re-running what a change touches

# Frontend only (server/frontend)
npm run lint                 # ESLint
npm run typecheck            # tsc against the installed UI library, then over vite.config.ts
npm run typecheck:local-ui   # tsc against a sibling checkout of the UI library
```

The Vite build does not type-check, so `typecheck` is the frontend's only type gate. Its
second run covers `vite.config.ts` through `tsconfig.node.json`, the files Node runs rather
than the browser.

`build` names its workspaces one by one instead of using `--workspaces`, because
`shared` has to be built first and the others need its output. `--workspaces` would
build `shared` a second time, and its ordering would rest only on the position of
`shared` in the `workspaces` array. **A new workspace has to be added to that list by hand.**

There is no `start:frontend`: the frontend is a Vite SPA that builds into
`server/dist/public`, which the backend serves itself (see `server/backend/src/index.ts`).
`npm run start:server` therefore serves the frontend too. To look at a production
bundle without the backend, use `npm run preview -w server/frontend`.

## Architecture Patterns

### Backend (server/backend)
- **Controller** → handles HTTP/WS routes
- **Service** → business logic (RecordService, SiteService, ProviderService, ActivityService, …).
  A refusal is a `RequestError` with its status; controllers answer through `serviceReply`
- **Repository** → data access (UserRepository, ActivityRepository, etc.)
- SQLite with WAL mode; schema managed via Umzug migrations in `core/migrations/`.
  `00_initial.ts` is the schema dpm starts from; every change after it is a migration of its
  own, listed in `Database.ts`. Migrations get no tests.
- `DashboardService` holds the open dashboard sockets; it sends `DashboardMessage` only.
- A DNS server is reached through a client in `providers/` (`DnsProvider` interface, chosen by
  `clientFor`); what turns its answers into dpm's terms is a pure mapping next to it, tested
  against recorded answers. **No test talks to a real provider.** Samba AD's records the domain
  controllers register for themselves are never listed (`samba/sambaProtection.ts`, the rules
  of samba-ad-manager). What the providers hold is
  read by `ProviderReadService` and kept in memory; which provider uses a zone is derived
  (`zoneOwnership`), never stored.
- Writing is `SyncService`. Where a record goes is `recordTargets`, what to do at each provider
  `planRecord` (`syncPlan.ts`) -- both pure and tested; the service only does what the plan
  says. `record_links` hold what dpm last wrote at each provider: a record changed in dpm is
  written, an entry changed at the provider is drift. Writes go first, removals only once every
  provider of the record holds it. Reading and writing a provider go through its queue
  (`queueFor`), one at a time. After every reading, `afterReading` compares all records with
  that provider -- the only place drift is found and failures are retried. **dpm touches only
  entries a link holds**; AdGuard Home adds duplicates, so "is it there already" is asked of the
  reading first.
- Secrets the server has to read back (provider credentials) are encrypted with
  `SecretCrypto` (`secretKey`); they never go back to the browser.

### Frontend (server/frontend/src)
- Feature-based structure under `features/` (dashboard, records, unmanaged, providers, sites, activity, users, auth, webhooks, settings, app)
- What the server holds lives in one TanStack Query cache (`lib/queryClient.ts`), read through
  the modules in `queries/` and addressed by `lib/queryKeys.ts`. Zustand holds only
  `useUIStore`, what this browser alone knows.
- Every request goes through `lib/api.ts`, which parses the answer against a schema from
  `shared/src/responses.ts` and throws the server's reason on a refusal. `apiFetch` stays
  below it; no component calls `fetch`.
- A dashboard message changes a cache entry through a pure function in `lib/cacheUpdates.ts`.
  The messages are one union in `shared/src/dashboardMessages.ts`; the backend sends through
  it, and the socket handler's `switch` ends in `assertNever`.
- A lost socket is said: `isLost` in `WebSocketContext` turns true `LOST_AFTER_MS` (5 s) after
  the socket is gone and drives the library's `ConnectionBanner` and `StatusDotProvider`.
  After a reconnect everything the server does not push on connect (`isPushedOnConnect` in
  `lib/queryKeys.ts`) is invalidated. A new cache area the server pushes on connect has to
  be added there.
- Every path lives once in `lib/paths.ts` (`ROUTES`, `paths`, `activitySearch`). No path literal
  anywhere else. The route tree in `features/app/routes.tsx` is the one description of what
  lives where: the sidebar (`handle.nav`), the document title (`lib/pageTitle.ts`), "back"
  (`useBackPath`, the route above -- never `location.state`) and the `errorElement` are all
  read off it. A new page is a route there, with its lazy import in `lazyPages.ts`.
  The breadcrumb in a page's header (`HeaderBreadcrumb`, `lib/breadcrumb.ts`) is read off
  the same handles as the title; a page below a list uses it as its heading.
- A route whose subject is gone for good throws `NotFoundError` (`lib/notFound.ts`).
- An editor keeps its draft in `useEntityForm`, checked against the request schema from
  `shared`; its rules are pure and live in the feature's `lib/<name>Form.ts`, with a test.
  Leaving a page with unsaved changes is asked about in one place, `useUnsavedChangesGuard`
  (the router's blocker); an editor navigates away with its `close` or `leave`, never with
  `navigate` of its own.
- A list describes its columns once, as `DataColumnDef[]` (`columns`), with `actionsColumn`
  and `listGroups` from the library; its `emptyMessage` is an `EmptyState`, a search without
  a hit a `noResultsMessage`. The search goes to the view as `searchFilter`, never applied
  to `data` beforehand, or the view cannot tell the two apart.
- Dates follow the browser's locale (`formatDate`, `formatTime` in `utils.ts`; no locale
  literal). "How long ago" is `<RelativeTime>` on `useNow`, the date in its tooltip.
- React Contexts: WebSocketContext, AuthContext. The theme is the library's `ThemeProvider`,
  mounted with `STORAGE_KEYS.theme`
- Every key in the browser's storage lives once in `lib/storageKeys.ts` (`STORAGE_KEYS`,
  written `dpm.<area>.<what>`). No key literal anywhere else; renaming one forgets the
  stored value and needs no migration.
- Vite proxies `/api` and `/ws` to backend in dev

### Shared (shared)
- Single source of truth for types and validation across all workspaces
- Always build shared first when making type changes: `npm run build -w shared`
- Two entry points: `@dpm/shared` (types, schemas, constants — imported by the frontend)
  and `@dpm/shared/node` (Node-only code, currently the pino logger). Anything that needs
  Node goes behind `/node`, or it lands in the browser bundle.

## Configuration

- Server config: `server/config.yaml` (from `config.example.yaml`)
- `VITE_USE_LOCAL_UI` / `VITE_UI_COMPONENTS_PATH` (shell environment of the frontend
  build, not read from `.env`): set `VITE_USE_LOCAL_UI=true` to build against a sibling
  checkout of `@stefgo/react-ui-components` instead of the installed package
  (default path `../react-ui-components`). **Off by default**, so a build never depends
  on a checkout that CI and containers do not have. Vite, Tailwind and
  `tsconfig.local-ui.json` (`npm run typecheck:local-ui`) all switch on it; use them
  together, or the compiler and the bundler see two versions of the same module.
  Tailwind swaps the **preset** as well as its content glob: the preset carries the theme,
  so a local build on the installed preset would run new components on the old theme.

## Code Style

- **Indentation**: 4 spaces in all workspaces and config files, no tabs. No formatter is
  configured — match the surrounding file.
- **Linting**: two configs, one per kind of code, because a file must not be matched by
  both. `eslint.config.mjs` at the root covers `shared` and `server/backend`
  (js, mjs, ts; Node globals; typescript-eslint recommended, no type information) and
  ignores `server/frontend`; `server/frontend/eslint.config.js` covers the frontend's
  `src/**/*.{ts,tsx}` and adds react-hooks and react-refresh. A new Node workspace is
  covered by the root config without another file. Errors fail the run; no rule is
  downgraded to a warning. `prefer-const` runs with `ignoreReadBeforeAssign`, for the
  `let` a closure reads before anything assigns it.
  A context is split into a JSX-free `XContext.ts` (context object and hook) and an
  `XProvider.tsx`, so `react-refresh/only-export-components` stays an error.
  `react-hooks/set-state-in-effect` is an error too: a loader lives inside its effect and
  sets state only after an `await` (a reload bumps a counter the effect depends on), and
  state derived from props is reseeded while rendering, not in an effect.
- **Quotes**: double quotes for string literals in every workspace, double quotes for JSX
  attributes. Template literals where they earn it. There is no formatter, so this is a rule
  rather than a setting: what matters is that a file does not mix the two.
- **Language**: TypeScript throughout

## Commits

- **Conventional Commits**, checked locally by `.githooks/commit-msg` against
  `commitlint.config.mjs`. The root `prepare` script sets `core.hooksPath` on every
  `npm install`. `ci.yml` lints commits only on pull requests, and this repository is
  maintained without them, so the hook is the check that actually runs.
- **With `bump: auto` the commit type is the only input the version number comes from**: `feat` raises the
  minor, `fix`, `perf` and `revert` the patch, every other type releases nothing.
- **Commit messages are written in English** — subject and body.
- **No `!` in the header** (`feat!: …` is rejected by the `no-breaking-bang` rule): the
  Angular preset semantic-release reads commits with does not know it, so such a commit
  would release nothing. A breaking change is declared with a `BREAKING CHANGE:` footer,
  which raises the **minor** position, not the major one.
- **A body line that starts with one word and a colon** (`happened: …`) is parsed as the
  start of the footer. Rephrase it.
- `subject-case` is off, so an English subject in sentence case is fine
  (`fix: Validate the settings before saving them`).
- Release commits (`chore(release): x.y.z`) are exempt from commitlint; their body is the
  generated release notes.
- `.githooks/pre-push` allows pushing `main` and `dev` only; topic branches stay local.

## Versioning and Releases

`semantic-release` owns the version. It runs from `.github/workflows/release.yml`, which is
**`workflow_dispatch` only and releases from `main` (a release) or `dev` (a beta,
`x.y.z-beta.n`)**: a release is an action, not a side effect of pushing. **Never bump a
version or create a `v*` tag by hand.**

The workflow calls [stefgo/release-workflows](https://github.com/stefgo/release-workflows),
which carries semantic-release and its configuration for every stefgo project. There is no
`release` entry in `package.json` and no semantic-release package installed here.

- Inputs: `dry_run` (default on) shows the next version and the complete notes and changes
  nothing; `bump` (`auto` | `patch` | `minor` | `major`) takes the step from the commit types
  or is the step itself, whatever the commits say. `major` is the only way a major version is
  created. A run that was asked for and produces no release fails.
- **Every release needs hand-written notes in `.release/next.md`** — what is new, what an
  upgrade needs. They go above the generated list of commits; without them the workflow
  refuses. A beta keeps the text, the release from `main` empties the file. Write it as part
  of the change that deserves a sentence, not at release time.
- **`dev` is merged into `main` with its history — never squashed or rebased** — and `main`
  back into `dev` before the next beta. The workflow checks both and refuses otherwise.
- The root `package.json` is the single source of truth for the version. It starts at
  `0.0.0`; without a release tag semantic-release makes the first release `1.0.0`. The
  workspace manifests keep `1.0.0` and nothing reads them.
- semantic-release pushes the tag over `GITHUB_TOKEN`, which starts no workflow, so
  `release.yml` dispatches `build.yml` on the tag ref itself and waits for it. That build is
  what moves `latest`.
- A push to `main` or `dev` publishes the rolling `:main` / `:dev` image plus `sha-<short>`
  — no tag, no version, no changelog entry.
- The version string the dashboard shows is derived in `server/frontend/vite.config.ts`:
  build argument, then the root `package.json` (with `+<hash>` when the commit carries no
  release tag), then git.

### The release notes are part of the commit

Before every commit, read `.release/next.md` and bring it up to date with what the commit
changes — in the same commit, not at release time.

- A commit that changes what a user sees or has to do — a feature, a fix, a changed
  default, a renamed setting, anything an upgrade needs — is reflected in the text. A
  `feat`, `fix` or `perf` commit that leaves the file untouched needs a reason.
- A commit that changes nothing for a user (`ci`, `test`, `refactor`, `docs`, `chore`,
  most of `build`) leaves the file alone. No line is added for the sake of it.
- Revise the text as a whole instead of appending a line per commit: it describes the
  release, not its history. Merge what belongs together, and remove a sentence a later
  commit made untrue — a feature taken back before the release is not in its notes.
- Write for someone who uses the project, in their terms: what is new, why it matters,
  what an upgrade needs. No file names and no internals; the list of commits below the
  text already names every change.
- The text goes below the HTML comment at the top of the file, with `###` headings. If
  the file holds only the comment, the text starts with this commit.

## Testing

Vitest, configured in `vitest.config.mts` at the root with one project per workspace:
`shared`, `frontend` and `backend`. All run in plain Node, so what is tested is
logic — nothing renders a component or starts the backend.

- A test lives next to its module (`activityText.ts`, `activityText.test.ts`).
- Every project but `shared` sets the `development` condition, so its tests read
  `shared/src` and need no build first.
- `shared` and `server/backend` build with `tsconfig.build.json`, which keeps the
  tests out of `dist`; `npm run typecheck -w <workspace>` is what type-checks them.
- Logic inside a class with side effects is moved into a pure module first and tested there.
- A backend module that imports `core/Database.js` or `config/AppConfig.js` reads the real
  `server.db` and `config.yaml` the moment it is imported. Its test replaces both with
  `vi.mock`; `src/testing/memoryDatabase.ts` gives an in-memory database on the current
  schema. **No test may open the files of a running installation.**

CI (`.github/workflows/ci.yml`) runs `npm run build`, `npm test`, `npm run typecheck` for
`shared`, `server/backend` and `server/frontend`, `npm run lint -w server/frontend` and
`npm run lint` on every branch and pull request; `build.yml` calls the same workflow and only
builds the image once it passes. Run the seven locally before pushing.

## Docs

See `docs/` for detailed documentation:
- `docs/index.md` — Landing page of the published site; **not** a copy of the README, and
  the only page that exists solely for the site
- `docs/api.md` — REST and WebSocket API
- `docs/backend.md` — Backend architecture
- `docs/frontend.md` — Frontend structure
- `docs/development.md` — Development guidelines, the documentation site itself
- `docs/quickstart.md` — The server with Docker Compose, the first sign-in
- `docs/configuration.md` — The server's `config.yaml` and the environment variables
- `docs/providers.md` — Per provider type: what it needs, what is read and what is left out
- `docs/security.md` — Reverse proxy, security headers, stored secrets, container user
- `docs/operations.md` — Images and tags, upgrading, backup, health, logs
- `docs/upgrade-notes.md` — What a release changes for a running installation, newest
  first; **a change an operator has to act on gets an entry here**
- `docs/webhooks.md` — Webhooks: filters, body templates, examples

### The docs are rendered twice

`docs/` is both the GitHub-browsable directory and the `docs_dir` of
[`mkdocs.yml`](mkdocs.yml) (MkDocs Material), published to
<https://stefgo.github.io/dns-provider-manager/> by
[`docs.yml`](.github/workflows/docs.yml) on pushes to `main`. **Every page has to
render in both**, which constrains three things:

- **A link out of `docs/` must be absolute**
  (`https://github.com/stefgo/dns-provider-manager/blob/main/…`). A relative
  `../compose.yaml` resolves on GitHub and nowhere else — MkDocs cannot follow a path
  outside its `docs_dir`, and `--strict` fails the build on it. Links between pages
  inside `docs/` stay relative.
- **`api.md` has a hand-written TOC with GitHub anchors** — the emoji is dropped and
  the leading space becomes a dash (`#-authentication`). `mkdocs.yml` sets
  `pymdownx.slugs.slugify(case=lower)` for exactly that reason. Changing the slugify
  function silently breaks those links.
- **A new page has to be added to `nav` in `mkdocs.yml`**; `--strict` fails on a page
  outside the navigation.

The workflow is deliberately **not** part of `ci.yml`/`build.yml`: that chain is the
gate on a release, and a documentation typo must not block one. The strict build runs on
every branch that touches the docs; only `main` deploys.
