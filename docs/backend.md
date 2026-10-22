# ⚙️ Backend Architecture

The server backend (`server/backend`) is the whole of DPM's control plane: it serves the
dashboard, keeps the records and talks to the DNS providers itself. There is no agent.

## 📂 Project Structure

**Fastify** with **TypeScript**, layered as **Routes → Controllers → Services → Repositories**.

```
server/backend/src/
├── config/
│   └── AppConfig.ts                  # config.yaml: read, validate, generate secrets, write back
├── controllers/                      # HTTP and WebSocket request handlers
│   ├── ActivityController.ts         # Activity list, seen state, deletion
│   ├── AuthController.ts             # Login, logout, session, OIDC
│   ├── RecordController.ts           # Records CRUD
│   ├── SiteController.ts             # Sites CRUD
│   ├── ProviderController.ts         # Providers CRUD
│   ├── serviceReply.ts               # Answers with a service's result or its RequestError
│   ├── SettingsController.ts         # Settings and the schedulers' status
│   ├── UserController.ts
│   ├── WebhookController.ts          # Webhook CRUD and test delivery
│   ├── WebSocketController.ts        # The dashboard socket
│   └── websocket/
│       └── Heartbeat.ts              # ping/pong, terminates a socket that stops answering
├── core/
│   ├── Database.ts                   # SQLite (WAL) and the Umzug migration runner
│   ├── HealthFile.ts                 # Writes the address the container HEALTHCHECK asks
│   └── migrations/
│       ├── context.ts                # MigrationContext: the database Umzug hands a migration
│       ├── 00_initial.ts             # users, activity, activity_seen, scheduler_state, webhooks
│       ├── 01_dns.ts                 # providers, sites, site_providers, records, record_sites
│       └── 02_provider_zones.ts      # provider_zones
├── providers/                        # The clients that talk to the DNS servers
│   ├── DnsProvider.ts                # What dpm asks of one: zones, records (read only for now)
│   ├── clients.ts                    # The client for a provider's type, or null while it has none
│   └── cloudflare/                   # CloudflareClient (API v4, paged) and cloudflareMapping (pure)
├── repositories/                     # Database access
│   ├── ActivityRepository.ts         # insert (idempotent by id), seen state, retention
│   ├── HealthRepository.ts           # SELECT 1 for the liveness probe
│   ├── ProviderRepository.ts         # providers, without their secret on the way out, with their zones
│   ├── ProviderZoneRepository.ts     # provider_zones: what each reading found, which are ticked
│   ├── RecordRepository.ts           # records with their sites
│   ├── SiteRepository.ts             # sites with their providers and record count
│   ├── SchedulerStateRepository.ts   # scheduler_state: last run, planned run
│   ├── UserRepository.ts
│   └── WebhookRepository.ts          # webhooks, last delivery result
├── routes/
│   └── api.ts                        # Route registration (all endpoints)
├── services/
│   ├── ActivityService.ts            # Records events, applies level overrides, tells dashboards and webhooks
│   ├── AuthService.ts                # Local and OIDC sign-in, session validity
│   ├── DashboardService.ts           # The open dashboard sockets, broadcast and per-user sends
│   ├── NotificationCleanupService.ts # Retention of the activity history
│   ├── ProviderService.ts            # Providers: names, fixed type, the secret encrypted, ticked zones
│   ├── ProviderReadService.ts        # Reading the providers: scheduler, readings in memory, test
│   ├── UnmanagedService.ts           # What the providers hold and dpm does not; adopting it
│   ├── unmanaged.ts                  # Which entries are unmanaged (pure)
│   ├── zoneOwnership.ts              # Which provider uses a zone (pure)
│   ├── RecordService.ts              # Records: sites exist, no conflict (recordConflict)
│   ├── RequestError.ts               # A refusal with its HTTP status (400, 404, 409)
│   ├── SiteService.ts                # Sites: names, providers exist, no record left without a site
│   ├── changes.ts                    # What a change changed, for the *.changed events
│   ├── ScheduledJob.ts               # Timer, run bookkeeping and status of a scheduler
│   ├── SecretCrypto.ts               # AES-256-GCM with secretKey, for secrets the server reads back
│   ├── SessionCookie.ts              # The httpOnly session cookie and the readable flag beside it
│   ├── SettingsService.ts            # Settings retrieval, update and persistence
│   └── WebhookService.ts             # Renders and delivers events to the webhooks
├── testing/
│   └── memoryDatabase.ts             # An in-memory database on the current schema, for tests
├── types/
│   └── fastify.d.ts                  # Fastify request/instance augmentations
└── index.ts                          # Server setup and entry point
```

## 🏗️ Core Components

- **Routes** (`routes/api.ts`) — every endpoint in one place. `/api/health` and the
  sign-in routes are public; everything under `/api/v1` runs behind a hook that verifies the
  session and asks `AuthService.isSessionCurrent` whether it is still valid (a deleted user
  or a changed password ends it).
- **Controllers** parse the request with the schema from `@dpm/shared` and answer `400` with
  the first issue when it does not match. They hold no logic of their own.
- **Services** hold the logic. `ActivityService.record` is the one way an event is written:
  it applies `activity_level_overrides`, stores the event and hands what was new to the
  dashboards (`ACTIVITY_APPENDED`) and the webhooks.
- **Repositories** are the only code that writes SQL.
- **Records, sites and providers** go through a service each, which checks what the schema
  cannot: names unique ignoring case, ids that exist, a record that clashes with another
  (`recordConflict` in `@dpm/shared`), a site that would leave a record without one. A refusal
  is a `RequestError`, answered by `serviceReply` with its status. Every change is an activity
  event with `source: "user"`; a `*.changed` event lists its `changes`.
- **Reading the providers** is `ProviderReadService`: the `provider-read` scheduler, a reading
  at startup and after a provider is saved, one provider or all on request. A reading fetches
  the zones (`ProviderZoneRepository`), works out which the provider uses (`zoneOwnership`),
  and keeps the A, AAAA and CNAME records of those in memory — a restart reads again. It
  writes nothing to a provider. The moment a provider stops or starts answering is an
  activity event; every reading is a `READINGS_UPDATE` on the dashboard socket.
- **`DashboardService`** keeps every open dashboard socket with the user who opened it.
  `broadcastToDashboard` and `sendToUser` take a `DashboardMessage`, so a message that is not
  part of the union in `shared/src/dashboardMessages.ts` does not compile.

## 🔁 Process Lifecycle (`src/index.ts`)

1. Migrate the database, initialise OIDC, create the `admin` user on an empty database.
2. Mark scheduler runs that a previous process did not finish as `interrupted`; start the
   schedulers.
3. Register the plugins (CORS off, rate limit for the login, helmet, cookies, JWT, static
   files, WebSocket) and the routes.
4. Listen, write the health file, log which proxies are trusted.

`SIGINT` and `SIGTERM` stop the schedulers and close the server, with a 5-second limit so a
socket that never answers cannot hold the container until Docker kills it.

## 📝 Logging

pino, through `@dpm/shared/node`. `LOG_LEVEL` wins over `logLevel` in `config.yaml`;
`LOG_FORMAT` picks between pretty single lines and JSON (default: JSON in production).
Requests are logged at `debug`, failed ones at `warn`, server errors at `error`.

## 🗄️ Database Management

SQLite through better-sqlite3, in WAL mode, at `server/backend/data/server.db`, with foreign
keys switched on explicitly for every connection, rather than relying on how better-sqlite3 was
compiled. The schema
is managed by Umzug: each migration is a module in `core/migrations/` and is listed in
`Database.ts`. `00_initial.ts` is the schema DPM starts from; every later change is a
migration of its own.

| Table | Contents |
| :---- | :------- |
| `users` | Accounts, bcrypt hashes, allowed sign-in methods, `token_version` (raising it ends every session of the user) |
| `activity` | Events: kind, level, subject and data as JSON, `occurred_at`, `received_at` |
| `activity_seen` | Which user has seen which event |
| `scheduler_state` | Per scheduler: the run in progress, the last finished run, the planned run |
| `webhooks` | Targets, filters, body template, the result of the last delivery |
| `providers` | Type, name, `settings` (JSON, what is particular to the type), `secret` (encrypted with `secretKey`), auto-correct, last contact |
| `provider_zones` | The zones a provider's last reading found, and which are ticked under "Selected zones". Who uses a zone is derived, not stored |
| `sites`, `site_providers` | Sites and which providers belong to them |
| `records`, `record_sites` | Records — unique by name, type and value — and their sites. A site cannot be deleted under a record that has no other (RESTRICT) |

## 🔐 Authentication Flow

A login (local or OIDC) sets the session as an httpOnly cookie (`dpm_session`) holding a JWT
with the user's id and `token_version`. The same JWT is accepted in an `Authorization: Bearer`
header for scripts. The dashboard socket reads the cookie from the handshake.

## ⚙️ Configuration (`src/config/AppConfig.ts`)

Reads `server/config.yaml`, generates `jwtSecret` and `secretKey` when they are missing and
writes them back, validates the file against `AppConfigSchema` from `@dpm/shared` and stops the
start on the first invalid value. Unknown keys are kept and logged. `DPM_SERVER_PORT` and
`DPM_TRUSTED_PROXIES` override their keys.

## 📦 Key Dependencies

Fastify 5 with `@fastify/cookie`, `cors`, `helmet`, `jwt`, `rate-limit`, `static` and
`websocket`; better-sqlite3 and Umzug; openid-client; bcryptjs; yaml; pino.
