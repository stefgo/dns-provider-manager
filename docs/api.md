# 📚 API Documentation

**Base URL:** `/api` (REST endpoints use `/api/v1` prefix unless otherwise noted)

> **Note:** All API responses are JSON formatted. All protected endpoints require a valid session: the `dpm_session` cookie set by the login, or the same JWT in an `Authorization: Bearer <token>` header.

> **Validation:** Every endpoint that takes a body or query parameters checks them against a Zod schema from `@dpm/shared` before doing anything else. A request that does not match is answered with **`400`** and a single message that starts with the path of the first offending field, e.g. `{ "error": "name: A name is required" }`. Only the first problem is reported; fix it and the next request names the next one.


## 📖 Table of Contents

- [Authentication](#-authentication)
    - [Login](#login)
    - [Logout](#logout)
    - [Current Session](#current-session)
    - [OIDC Configuration](#oidc-configuration)
    - [OIDC Login](#oidc-login)
    - [OIDC Callback](#oidc-callback)
- [Users](#-users)
    - [List Users](#list-users)
    - [Create User](#create-user)
    - [Update User](#update-user)
    - [Delete User](#delete-user)
- [Settings & Maintenance](#-settings--maintenance)
    - [Get Settings](#get-settings)
    - [Update Settings](#update-settings)
    - [Run Activity Cleanup](#run-activity-cleanup)
    - [Scheduler Status](#scheduler-status)
- [Activity](#-activity)
    - [List Activity](#list-activity)
    - [Mark Seen](#mark-seen)
    - [Delete Activity](#delete-activity)
- [Webhooks](#-webhooks)
    - [List Webhooks](#list-webhooks)
    - [Create Webhook](#create-webhook)
    - [Update Webhook](#update-webhook)
    - [Delete Webhook](#delete-webhook)
    - [Send A Test Delivery](#send-a-test-delivery)
- [Misc](#-misc)
    - [Health](#health)
- [WebSockets](#-websockets)
    - [Dashboard Connection](#dashboard-connection)

---

## 🔐 Authentication

**Revocation.** A valid signature is not enough. The JWT carries the user's
`token_version` as `tv`, and every protected request and every dashboard handshake
compares it with the user's row. Changing a user's password or auth methods raises that
counter, and deleting the user removes the row, so all of that user's sessions end at
once: the next request answers `401`, an open dashboard socket is closed with `4001`.
A user who changes their own password gets a fresh cookie in the same response; their
dashboard socket closes with `4002` and reconnects on it. Tokens issued before this
existed carry no `tv` and are refused — one login after the update.

### Login

`POST /api/login`

**Description:** Authenticates a user with local credentials and starts a session. The session token is set as a cookie and is not part of the response body.

#### Request Body

| Field      | Type   | Required | Description               |
| :--------- | :----- | :------- | :------------------------ |
| `username` | string | **Yes**  | The username of the user. |
| `password` | string | **Yes**  | The password of the user. |

**Example Request:**

```json
{
    "username": "admin",
    "password": "secretpassword"
}
```

#### Response

```json
{
    "success": true
}
```

The response sets two cookies, both with `Path=/`, `SameSite=Strict` and a `Max-Age` that ends when the token does (`jwtExpiresIn`, default `12h`). `Secure` is added when the request came in over HTTPS (behind a reverse proxy listed in `security.trusted_proxies`: `X-Forwarded-Proto: https`).

| Cookie        | `HttpOnly` | Content                                                                 |
| :------------ | :--------- | :---------------------------------------------------------------------- |
| `dpm_session` | yes        | The JWT. Sent by the browser on every request and on the WebSocket handshake. |
| `dpm_auth`    | no         | `1`. Carries no secret; tells the dashboard that a session exists.      |

Every protected endpoint accepts the session either as the `dpm_session` cookie or as `Authorization: Bearer <token>`. A script can log in with this endpoint and send the value of `dpm_session` as a bearer token.

- **400** — `username` or `password` missing or empty. A malformed request is not a failed login.
- **401** — `Invalid credentials`: unknown user, wrong password, or an account without a local password (OIDC only). All three answer the same.

#### Rate Limit

At most **10 attempts per 15 minutes** per client IP, successful or not. Further attempts
are answered with `429 Too Many Requests` until the window has passed; the response carries
`x-ratelimit-*` and `retry-after` headers. No other endpoint is rate limited.

### Logout

`POST /api/auth/logout`

**Description:** Ends the browser session by clearing both cookies. Unauthenticated, so that an expired session can be logged out of too. The token itself stays valid until it expires; the server keeps no session list to revoke it from.

#### Response

```json
{
    "success": true
}
```

### Current Session

`GET /api/v1/me`

**Description:** Who the current session belongs to and when it expires. The dashboard reads the username, the user id and the expiry (for its automatic logout) from here, because it cannot read the httpOnly cookie. Protected like every `/api/v1` endpoint: without a valid session it answers `401`.

#### Response

| Field       | Type           | Description                                   |
| :---------- | :------------- | :-------------------------------------------- |
| `id`        | number         | The user's id.                                |
| `username`  | string         | The user's name.                              |
| `expiresAt` | string \| null | ISO 8601 time at which the session expires. |

```json
{
    "id": 1,
    "username": "admin",
    "expiresAt": "2026-09-12T06:00:00.000Z"
}
```

### OIDC Configuration

`GET /api/auth/config`

**Description:** Returns the public authentication configuration. Used by the frontend to determine whether to show local login, OIDC login, or both.

#### Response

| Field       | Type   | Description                                |
| :---------- | :----- | :----------------------------------------- |
| `type`      | string | `"oidc"` while an OIDC provider is configured and was discovered at startup, otherwise `"local"`. Local login stays available either way. |

### OIDC Login

`GET /api/auth/login`

**Description:** Redirects the user's browser to the OIDC provider's login page. Generates a PKCE code verifier/challenge and stores state for CSRF protection.

#### Response

- **302 Redirect:** Redirects to the OIDC provider.
- **404** — OIDC is not configured.

### OIDC Callback

`GET /api/auth/callback`

**Description:** Handles the callback from the OIDC provider. Exchanges the authorization code for a local JWT session token.

#### Query Parameters

| Parameter | Type   | Required | Description                                           |
| :-------- | :----- | :------- | :---------------------------------------------------- |
| `code`    | string | **Yes**  | The authorization code returned by the OIDC provider. |
| `state`   | string | **Yes**  | The state parameter for CSRF protection.              |

#### Response

- **302 Redirect:** Sets the session cookies (see [Login](#login)) and redirects to `/`. The token is not put into the redirect URL.
- **500** — `Authentication failed: <reason>`: OIDC is disabled, the state does not match, or the code exchange failed.

---

## 👤 Users

### List Users

`GET /api/v1/users`

**Description:** Retrieves a list of all registered users.

#### Response (Array of User objects)

| Field          | Type   | Description                                             |
| :------------- | :----- | :------------------------------------------------------ |
| `id`           | number | The unique identifier of the user.                      |
| `username`     | string | The username.                                           |
| `auth_methods` | string | Comma-separated list of allowed authentication methods. |
| `created_at`   | string | ISO 8601 timestamp of creation.                         |
| `updated_at`   | string | ISO 8601 timestamp of last update.                      |

**Example Response:**

```json
[
    {
        "id": 1,
        "username": "admin",
        "auth_methods": "local",
        "created_at": "2024-01-01T10:00:00.000Z",
        "updated_at": "2024-01-01T10:00:00.000Z"
    }
]
```

### Create User

`POST /api/v1/users`

**Description:** Creates a new user.

#### Request Body

| Field          | Type   | Required      | Description                                               |
| :------------- | :----- | :------------ | :-------------------------------------------------------- |
| `username`     | string | **Yes**       | The desired username.                                     |
| `password`     | string | _Conditional_ | Required when `auth_methods` includes `"local"`.          |
| `auth_methods` | string | No            | Auth methods: `"local"`, `"oidc"`, or `"local,oidc"`. Defaults to `"local"`. Any other value is rejected with `400`. |

**Example Request:**

```json
{
    "username": "jdoe",
    "password": "password123",
    "auth_methods": "local,oidc"
}
```

#### Response

```json
{ "status": "created" }
```

- **400** — invalid body, or `auth_methods` includes `local` without a `password`.
- **409** — username already exists.

### Update User

`PUT /api/v1/users/:userId`

**Description:** Updates an existing user's password or authentication methods.

#### Path Parameters

| Parameter | Type   | Required | Description                   |
| :-------- | :----- | :------- | :---------------------------- |
| `userId`  | string | **Yes**  | The ID of the user to update. |

#### Request Body

| Field          | Type   | Required | Description                                                     |
| :------------- | :----- | :------- | :-------------------------------------------------------------- |
| `password`     | string | No       | The new password. Only valid if user has `"local"` auth method. |
| `auth_methods` | string | No       | New comma-separated list of `local` and `oidc`. An empty string leaves the methods unchanged. |

#### Response

```json
{ "status": "updated" }
```

- **400** — invalid body, a `password` for a user without `local`, or `local` for a user who has no password and gets none.
- **404** — user not found.

### Delete User

`DELETE /api/v1/users/:userId`

**Description:** Deletes a user. Cannot delete yourself or the last remaining user.

#### Path Parameters

| Parameter | Type   | Required | Description                   |
| :-------- | :----- | :------- | :---------------------------- |
| `userId`  | string | **Yes**  | The ID of the user to delete. |

#### Response

```json
{ "status": "deleted" }
```

- **400** — `Cannot delete yourself` or `Cannot delete the last user`.
- **404** — user not found.

---

## 🛠️ Settings & Maintenance

### Get Settings

`GET /api/v1/settings/cleanup`

**Description:** Retrieves the `settings` block of `config.yaml`, every default filled in. The known values are returned as strings; a key added to the file by hand comes back as YAML read it. The `security` block is not part of the response: it is configured in `config.yaml` only.

#### Response

The defaults:

```json
{
    "notification_retention_days": "90",
    "notification_retention_count": "500",
    "notification_cleanup_interval_hours": "24",
    "activity_level_overrides": ""
}
```

| Setting                                      | Description                                                                   |
| :------------------------------------------- | :---------------------------------------------------------------------------- |
| `notification_retention_days`                | Days to keep activity events, measured against `occurredAt`. `"0"` is not "forever": it falls back to `90`. |
| `notification_retention_count`               | Minimum number of the newest activity events always kept.                     |
| `notification_cleanup_interval_hours`        | Interval of the automatic activity cleanup. `"0"` disables the scheduler.     |
| `activity_level_overrides`                   | The level an event kind is recorded with: `kind=level` entries separated by commas, `""` for none. `level` is `trace`, `info`, `warning`, `error`, or `none` to not record the kind at all. |

The `notification_*` names are kept from the projects DPM started from; the settings page calls the list "Activity History". A key this version does not know is kept in `config.yaml`, ignored and logged as unknown at startup.

### Update Settings

`PUT /api/v1/settings/cleanup`

**Description:** Updates settings. All fields are optional; only provided fields are updated.

#### Request Body

Pass any of the setting keys to update them.

```json
{
    "notification_retention_days": "30"
}
```

| Kind of setting | Keys | Accepted values |
| :-------------- | :--- | :-------------- |
| Counts, days, intervals | `notification_*` | A non-negative whole number, as string or number. Stored as string. |
| Event levels | `activity_level_overrides` | Empty, or `kind=level` entries separated by commas or line breaks. Any kind is accepted, each only once. |

Keys not listed are accepted and written as they are: the settings page sends back everything it read, including keys an operator added to `config.yaml` by hand, and rejecting or dropping them would delete them from the file.

#### Response

```json
{ "success": true }
```

- **400** — a value does not match the table above, or the body contains `security`. Proxy and HSTS settings are configured in `config.yaml` only; a session token must not be enough to change them.

> A changed value takes effect without a restart: `notification_*` restarts the `NotificationCleanupService` scheduler. `activity_level_overrides` is read whenever an event is written, so it applies to the next event and leaves the stored ones as they are.

### Run Activity Cleanup

`POST /api/v1/settings/cleanup/notifications`

**Description:** Runs `NotificationCleanupService` now, applying the retention policy to the activity table. Recorded as a `manual` run of `notification-cleanup`. The path keeps the old name; what it prunes is the activity list.

#### Response

```json
{ "success": true, "removed": 12 }
```

---

### Scheduler Status

`GET /api/v1/settings/scheduler-status`

**Description:** Returns the current status of the schedulers the server itself runs.

#### Response

```json
{
    "schedulers": {
        "notification-cleanup": {
            "isRunning": false,
            "nextRun": "2026-04-19T04:00:00.000Z",
            "lastRun": {
                "trigger": "schedule",
                "status": "success",
                "startedAt": "2026-04-18T04:00:00.000Z",
                "finishedAt": "2026-04-18T04:00:00.000Z",
                "result": { "removed": 12 },
                "error": null
            }
        }
    }
}
```

Every scheduler reports `isRunning`, `nextRun` (`null` while its interval is `0`) and `lastRun`, the last run it finished (`null` before its first). `lastRun.trigger` is `schedule` or `manual`; `lastRun.status` is `success`, `failed` (with `error`) or `interrupted` (the server stopped during the run; no `finishedAt`, no `result`). `result` is `{ removed }`. The state is kept in the database and survives a restart.

---

## 📣 Activity

What happened to the records, the providers and the server.

An event carries no message. It carries a `kind`, a `level`, what it is about and the facts
of that kind — an error, for instance — and the text is composed out of those by
`activityMessage` in `@dpm/shared`, for the dashboard and for [webhooks](webhooks.md) alike.
Filtering by `kind` and `level` is therefore exact rather than a search through prose.

`level` is one of `trace`, `info`, `warning` and `error`, lowest first. `trace` marks routine
bookkeeping, which the dashboard hides by default. A level this build does not know is read
as `info`.

`kind` is **not** a closed set: a row written by another version may carry a kind this server
does not know. It is kept as it is, and the dashboard prints the kind itself.

`occurredAt` is when it happened and orders the list; `receivedAt` is when the server stored
it.

| Kind | Level | `data` |
| :--- | :---- | :----- |
| `scheduler.failed` | `error` | `scheduler`, `trigger`, `error` |

The kinds about records, providers and sites join this table with those areas.

### List Activity

`GET /api/v1/activity`

`seen` is that of the calling user; who else has seen an event is not part of the answer.

**Response:**

```json
[
    {
        "id": "d3f1…",
        "occurredAt": "2026-09-13T03:00:07.412Z",
        "receivedAt": "2026-09-13T03:00:07.415Z",
        "source": "server",
        "kind": "scheduler.failed",
        "level": "error",
        "correlationId": null,
        "subject": null,
        "data": { "scheduler": "notification-cleanup", "trigger": "schedule", "error": "database is locked" },
        "seen": false
    }
]
```

Newest first by `occurredAt`.

### Mark Seen

`POST /api/v1/activity/seen` with `{ "ids": ["…"] }` marks the listed events seen by the
calling user in one request (ids that are not there are skipped; an empty or missing list is a
`400`) and answers `{ "ok": true }`. There is no endpoint for a single event: the dashboard
marks a whole group, or everything the filters leave, with this one.

### Delete Activity

`DELETE /api/v1/activity` removes all events and answers `{ "ok": true }`. Single events
cannot be deleted; retention and "Delete all" are the only ways an event goes.

Retention runs on its own through `notification_retention_days` and
`notification_retention_count` — the page they are set on is called "Activity History".

Over the dashboard WebSocket: a new event goes out as `ACTIVITY_APPENDED` with only the events
stored for the first time (a repeat from the at-least-once delivery is not sent again); marking
sends `ACTIVITY_SEEN` with the ids that turned seen, to the sessions of the calling user only;
"Delete all" broadcasts `ACTIVITY_UPDATE` with an empty list.

The same newly stored events are handed to the [webhooks](#-webhooks).

---

## 🪝 Webhooks

Targets outside the dashboard that events are reported to, each with a JSON body template of
its own. The template syntax, the context a template can read and examples for common services
are on the [Webhooks](webhooks.md) page.

A webhook as the API returns it:

```json
{
    "id": "10d18932-…",
    "name": "Ops channel",
    "enabled": true,
    "url": "https://hooks.example.com/services/…",
    "method": "POST",
    "headers": { "Authorization": "Bearer …" },
    "bodyTemplate": "{ \"text\": \"{{event.message}}\" }",
    "minLevel": "warning",
    "kinds": ["record.*", "scheduler.failed"],
    "timeoutMs": 10000,
    "lastStatus": 200,
    "lastError": null,
    "lastAttemptAt": "2026-09-27T21:01:49.380Z",
    "createdAt": "2026-09-27T20:58:12.004Z",
    "updatedAt": null
}
```

| Field | Description |
| :---- | :---------- |
| `url` | `http://` or `https://`. May contain placeholders, inserted as text. |
| `method` | `POST` (default) or `PUT`. |
| `headers` | Sent with every delivery; values may contain placeholders. `Content-Type: application/json` is always set. Returned in the clear. |
| `bodyTemplate` | JSON with `{{…}}` placeholders, filters and `$if`/`$map`/`$join` directives (see [Webhooks](webhooks.md#templates)), stored as written, at most 64 KiB. Refused with `400` when it is not valid JSON or a placeholder or directive does not parse. |
| `minLevel` | The lowest level sent: `trace`, `info`, `warning` (default) or `error`. |
| `kinds` | Kind patterns, `*` as wildcard. Empty sends every kind. |
| `timeoutMs` | Per attempt, 1000–60000 (default 10000). |
| `lastStatus` / `lastError` / `lastAttemptAt` | How the last delivery ended. Read-only. |

### List Webhooks

`GET /api/v1/webhooks` answers every webhook, ordered by name.

### Create Webhook

`POST /api/v1/webhooks` with the fields above except `id` and the read-only ones. Only
`name`, `url` and `bodyTemplate` are required. Answers **201** with the stored webhook.

### Update Webhook

`PUT /api/v1/webhooks/:webhookId` with the same body as a create; it replaces the whole
configuration. Answers the stored webhook, or **404**.

### Delete Webhook

`DELETE /api/v1/webhooks/:webhookId` answers `{ "success": true }`, or **404**.

### Send A Test Delivery

`POST /api/v1/webhooks/test` with the same body as a create — saved or not, so the editor can
try a target before storing it. Renders the sample event for the webhook's `kinds` (see
[Webhooks](webhooks.md#templates); the first sample when none matches), sends it once
without retries, and records nothing.

```json
{
    "ok": true,
    "status": 200,
    "error": null,
    "body": { "text": "[error] Activity cleanup failed: database is locked" },
    "response": "ok"
}
```

`body` is what was sent, `response` the first 500 characters of the answer. A target that
refuses is still a **200** here, with `ok: false`; **400** means the webhook itself is invalid.

---

## 🏓 Misc

### Health

`GET /api/health` (no `/v1` prefix)

**Description:** Liveness probe, used by the image's `HEALTHCHECK` and the CI smoke test. No authentication — a probe has no session, and the answer discloses nothing.

| Status | Body                 | Meaning                                                   |
| :----- | :------------------- | :-------------------------------------------------------- |
| `200`  | `{"status":"ok"}`    | The process serves requests and its database is reachable |
| `503`  | `{"status":"error"}` | The database could not be queried                         |

The DNS providers are not consulted: one unreachable provider must not mark the server as broken.

**Why under `/api`:** the server answers every path outside `/api` with the dashboard's `index.html` and HTTP `200`, so a probe on `/health` would report success even without the route. Under `/api`, an unknown path is a `404`.

## 🔌 WebSockets

### Dashboard Connection

`GET /ws/dashboard`

**Description:** WebSocket endpoint over which the server pushes changes to the dashboard.

#### Authentication

The `dpm_session` cookie, which the browser sends with the handshake by itself. A `token` query parameter is no longer accepted. Without the cookie the server closes with `4001 Unauthorized`, with an invalid or expired token with `4001 Invalid Token`.

#### Behavior

- On connect: The server immediately sends an `ACTIVITY_UPDATE` with the activity list.
- A ping/pong heartbeat runs every 30 seconds to detect dead connections.
- Everything `DashboardService` broadcasts goes to all open dashboard sessions; what concerns one user alone, to that user's sessions only.

#### The messages are a contract

Every message below is a member of `DashboardMessageSchema` in
[`shared/src/dashboardMessages.ts`](https://github.com/stefgo/dns-provider-manager/blob/main/shared/src/dashboardMessages.ts),
one discriminated union over `type`. The server's senders (`sendToDashboard`,
`broadcastToDashboard`, `sendToUser`) take that type, so a message that is not listed does not
compile. The dashboard parses each message against the schema and drops what does not match,
reporting it once per type.

The answers of the REST endpoints a browser calls are described the same way, in
[`shared/src/responses.ts`](https://github.com/stefgo/dns-provider-manager/blob/main/shared/src/responses.ts).
They describe what is sent, not what is accepted: a response schema carries none of the input
rules, and a nullable column arrives as `null`, not as a missing key.

#### Events (Server -> Dashboard)

| Event                 | Payload                                     | Description                                                       |
| :-------------------- | :------------------------------------------ | :---------------------------------------------------------------- |
| `ACTIVITY_UPDATE`     | `ActivityRecord[]`                          | The whole activity list: on connect, with the seen state of the session's user, and empty after "Delete all". |
| `ACTIVITY_APPENDED`   | `ActivityRecord[]`                          | Events stored for the first time, to be merged into the list by id. |
| `ACTIVITY_SEEN`       | `{ ids: string[] }`                         | Events the session's user has just marked seen. Sent to that user's sessions only. |
| `SCHEDULER_STATUS_UPDATE` | `{ scheduler, status }`                 | One scheduler's status, in the shape of [Scheduler Status](#scheduler-status), whenever a run starts or ends or its timer is set. |
