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
- [Records](#-records)
    - [List Records](#list-records)
    - [Create Record](#create-record)
    - [Update Record](#update-record)
    - [Delete Record](#delete-record)
    - [Release Record](#release-record)
    - [Preview A Record](#preview-a-record)
    - [Write A Record Again](#write-a-record-again)
    - [Settle Drift](#settle-drift)
    - [Pending Removals](#pending-removals)
- [Sites](#-sites)
    - [List Sites](#list-sites)
    - [Create Site](#create-site)
    - [Update Site](#update-site)
    - [Delete Site](#delete-site)
    - [Preview A Site](#preview-a-site)
- [Providers](#-providers)
    - [List Providers](#list-providers)
    - [Create Provider](#create-provider)
    - [Update Provider](#update-provider)
    - [Delete Provider](#delete-provider)
    - [Test A Provider](#test-a-provider)
    - [Read Providers](#read-providers)
- [Unmanaged](#-unmanaged)
    - [List Unmanaged Records](#list-unmanaged-records)
    - [Adopt](#adopt)
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

## 🌐 Records

A record is one name, type and value. The same name with another value is another record —
several A records of one name for round robin, or the same name in two sites with two answers
(split horizon). A record belongs to at least one [site](#-sites); it is written to every
provider of its sites — to a provider with zones only where one of its zones holds the name.
How writing works is described under [Providers](providers.md#writing).

```json
{
    "id": "4f0c…",
    "name": "app.example.com",
    "type": "A",
    "value": "192.168.1.10",
    "ttl": null,
    "proxied": false,
    "note": "",
    "siteIds": ["9a1e…"],
    "createdAt": "2026-10-22T14:45:01.501Z",
    "createdBy": "admin",
    "updatedAt": null,
    "updatedBy": null,
    "links": [
        { "providerId": "a50c…", "status": "in_sync", "error": null, "observed": null, "syncedAt": "2026-10-22T14:45:01.733Z" },
        { "providerId": "95a0…", "status": "drift", "error": null, "observed": { "name": "app.example.com", "value": "192.168.1.99", "ttl": null, "proxied": false, "disabled": false }, "syncedAt": "2026-10-22T14:45:01.733Z" }
    ],
    "skipped": []
}
```

| Field | Description |
| :---- | :---------- |
| `name` | The full name, stored in lower case without the trailing dot. Labels of letters, digits and hyphens, at most 253 characters; `*` as the first label for a wildcard. |
| `type` | `A`, `AAAA` or `CNAME`. |
| `value` | An IPv4 address (A), an IPv6 address (AAAA, stored in lower case) or a name (CNAME, never a wildcard, never the record's own name). |
| `ttl` | 60–86400 seconds, or `null` for each provider's own default. |
| `proxied` | Cloudflare's proxy. Every other provider ignores it. |
| `siteIds` | Any number of sites. A record without one is parked: kept, and written to no provider. |
| `note` | Free text, at most 500 characters. Written to no provider. |
| `links` | Read only. Where the record stands at each provider it goes to, and at each it is still to be removed from. `status`: `in_sync`, `pending` (not written yet: read only, not read yet — `error` says why), `error` (the last attempt failed; tried again after the provider's next reading), `drift` (changed or switched off there — `observed` is what it holds), `missing` (deleted there), `removing`. |
| `skipped` | Read only. Providers of its sites that do not get the record, with `reason` — a provider with zones none of which holds the name, or whose zones were not read yet. |

### List Records

`GET /api/v1/records` answers every record, ordered by name, type and value.

### Create Record

`POST /api/v1/records` with the fields above except `id`, the timestamps, `links` and
`skipped`. Only `name`, `type`, `value` and `siteIds` are required. The record is stored and
then written to its providers; the answer (**201**) comes once that is done and says in
`links` how it went. A provider that fails does not undo the record.

- **400** — a field does not match the table above, or a site does not exist.
- **409** — the record clashes with another one: the same name, type and value exist already
  (give that record another site instead), or a CNAME would stand beside another record of its
  name where both would be answered by the same DNS server — in a site both belong to, or at a
  provider two of their sites share — or beside an entry a provider holds that dpm does not
  manage; or a site has providers, none of which takes the name.

### Update Record

`PUT /api/v1/records/:recordId` with the same body as a create; it replaces the whole record.
Answers the stored record once it is written; **404** for an unknown id, **400** and **409** as
above. An update that changes nothing records no event and writes nothing. A provider the record
no longer goes to has it removed — once every provider it still goes to holds it.

### Delete Record

`DELETE /api/v1/records/:recordId` answers `{ "success": true }`, or **404**, once the record
is removed from its providers. A provider that cannot be reached keeps it until it can; see
[Pending Removals](#pending-removals).

### Release Record

`POST /api/v1/records/:recordId/release` answers `{ "success": true }`, or **404**. dpm deletes
the record and touches no provider: what they hold of it stays there as it is, is listed under
[Unmanaged Records](#list-unmanaged-records) from then on and can be adopted again.

### Preview A Record

`POST /api/v1/records/preview` with `{ "id"?, "record": { … } }` — the body of a create or an
update — or `{ "id", "delete": true }` answers what saving or deleting would do at each
provider. Changes nothing.

```json
{
    "conflict": null,
    "steps": [
        { "providerId": "a50c…", "action": "create", "reason": null },
        { "providerId": "c3d1…", "action": "delete", "reason": null }
    ],
    "skipped": []
}
```

`action` is `create`, `update`, `delete`, `adopt` (the provider holds the record already),
`none`, `blocked` (read only, or not read yet; `reason` says which) or `conflict`. `conflict`
is why saving would be refused (**409**), or `null`.

### Write A Record Again

`POST /api/v1/records/:recordId/sync` writes the record to its providers again: what failed,
and dpm's value over what drifted. Answers the record.

### Settle Drift

For a link in `drift` or `missing`:

- `POST /api/v1/records/:recordId/links/:providerId/rewrite` writes dpm's value to that provider
  again. Answers the record.
- `POST /api/v1/records/:recordId/links/:providerId/accept` takes over what the provider holds.
  A changed value becomes the record's and goes to its other providers too; a deletion (or a
  rewrite switched off in AdGuard Home) takes the record out of the sites it reached that
  provider through, and parks it when none is left — what the provider holds is not touched.
  Answers `{ "record": … }`.

**409** when the provider holds the record as dpm wrote it, or dpm does not write to it.

### Pending Removals

`GET /api/v1/records/removals` lists deleted records a provider still holds, because removing
them there failed: `[{ "providerId", "name", "type", "value", "error" }]`. Each is tried again
after the provider's next reading.

---

## 🧭 Sites

A site is a group of providers that give the same answers, such as `internal` and `external`.
A provider may belong to several sites.

```json
{
    "id": "9a1e…",
    "name": "internal",
    "description": "The DNS servers of the home network",
    "providerIds": ["a50c…", "95a0…"],
    "recordCount": 2,
    "createdAt": "2026-10-22T14:45:01.470Z",
    "updatedAt": null
}
```

### List Sites

`GET /api/v1/sites` answers every site, ordered by name.

### Create Site

`POST /api/v1/sites` with `name` (unique, ignoring case, at most 64 characters), `description`
(optional) and `providerIds` (optional). Answers **201** with the stored site; **409** for a
name another site has, **400** for a provider that does not exist.

### Update Site

`PUT /api/v1/sites/:siteId` with the same body; it replaces the site and its providers. A
provider that joins gets the site's records written, one that leaves has them removed — in
the background, after the answer.

### Preview A Site

`POST /api/v1/sites/preview` with `{ "id", "site": { … } }` answers, per provider, how many of
the site's records saving it would write there and remove: `[{ "providerId", "create", "delete" }]`.
Changes nothing; a new site (no `id`) answers `[]`.

### Delete Site

`DELETE /api/v1/sites/:siteId` answers `{ "success": true }`. Its records leave it and are
removed from its providers; a record that belonged to this site alone is parked.

---

## 🖥️ Providers

One provider is one access to a DNS server: a Cloudflare API token, an AdGuard Home instance,
a Samba AD domain. Its secret — the API token or the password — is stored encrypted and never
returned; `hasSecret` says whether one is stored.

| `type` | Fields besides `name`, `autoCorrect`, `readOnly` and `secret` |
| :----- | :-------------------------------------------------- |
| `cloudflare` | `zoneMode`: `all` (every zone the token sees) or `selected`; `zoneIds`: the zones ticked under `selected`, by Cloudflare's zone id |
| `adguard` | `url` (`http://` or `https://`), `username`, `allowSelfSigned` |
| `samba-ad` | `servers` (one or more `host` or `host:port`, port 636 unless named), `username`, `allowSelfSigned` |

```json
{
    "type": "adguard",
    "id": "a50c…",
    "name": "AdGuard 1",
    "autoCorrect": false,
    "readOnly": false,
    "writable": true,
    "hasSecret": true,
    "siteIds": ["9a1e…"],
    "createdAt": "2026-10-22T14:45:01.427Z",
    "updatedAt": null,
    "lastSeenAt": null,
    "lastError": null,
    "zones": [],
    "readable": false,
    "url": "http://192.168.1.2:3000",
    "username": "admin",
    "allowSelfSigned": false
}
```

`autoCorrect` decides whether drift at this provider is written back without asking.
`readOnly` keeps dpm from writing to it at all; it is read and compared all the same.
`writable` (read only) is whether dpm writes to it: not `readOnly`, and of a type dpm writes
to — not Samba AD yet.
`lastSeenAt` and `lastError` say when the server last read the provider and why it last
failed to. `readable` says whether this version can read the type; every type can.

`zones` are the zones the provider's last reading found — empty for AdGuard Home, which has
none — each as
`{ "id", "name", "selected", "owner" }`. `owner` is the provider that uses the zone — this one,
another one whose token sees it too, or `null`. A zone is used by at most one provider: one
ticked under `selected` wins over one merely seen under `all`, and otherwise the provider
created first keeps it. Ticking a zone that another provider has ticked already is refused
with **409**.

### List Providers

`GET /api/v1/providers` answers every provider, ordered by name.

### Create Provider

`POST /api/v1/providers` with `type`, `name` (unique, ignoring case), `secret` and the fields of
the type. Answers **201**; **400** without a secret, **409** for a name another provider has.

### Update Provider

`PUT /api/v1/providers/:providerId` with the same body. Without `secret` the stored one stays.
**400** when `type` differs from the stored one: a provider keeps its type.

### Delete Provider

`DELETE /api/v1/providers/:providerId` answers `{ "success": true }`. The provider leaves every
site it belonged to, and its secret is deleted.

### Test A Provider

`POST /api/v1/providers/test` with `{ "provider": { …as for a create… }, "id": "…" }` asks the
provider whether it answers, without saving anything. `id` is optional: it names a stored
provider whose secret stands in when `provider.secret` is left out.

```json
{ "ok": true, "message": "Cloudflare answered and lists 2 zones.", "zones": [{ "id": "…", "name": "example.com" }] }
```

The message says what the provider found: `AdGuard Home v0.107.79 answered and holds 6 DNS
rewrites.`, `Samba AD answered on dc1.sadm.test and holds 1 zone.` What each type reads, and
what it leaves out, is described under [Providers](providers.md).

A provider that refuses is a **200** with `ok: false` and its reason in `message`.

### Read Providers

The server reads every provider on a timer (`provider_read_interval_minutes`, default 5), once
at every start, and a provider whenever it is saved. A reading fetches the zones and the A,
AAAA and CNAME records of the zones the provider uses, and keeps them in memory. Then every
record is compared with what the provider holds: drift is found, writes that failed are tried
again, records still to go there are written and those to leave it removed — at this provider
only.

- `POST /api/v1/providers/:providerId/read` reads one provider now and answers its reading
  (see [List Unmanaged Records](#list-unmanaged-records)).
- `POST /api/v1/providers/read` reads every provider now, as a run of the `provider-read`
  scheduler, and answers `{ "success": true, "read": 2, "failed": 0 }`.

---

## 📥 Unmanaged

What the providers hold and dpm does not manage there. An entry is managed when a record
holds it — dpm wrote it, took it over, or sees it as what a record drifted to — or, before
that is known, when dpm has a record with its name, type and value in a site of that
provider. Everything else is unmanaged, except a rewrite switched off in AdGuard Home.

### List Unmanaged Records

`GET /api/v1/unmanaged`

```json
{
    "readings": [
        { "providerId": "…", "providerType": "cloudflare", "readAt": "2026-10-22T15:49:00.452Z", "error": null, "recordCount": 7 }
    ],
    "entries": [
        {
            "providerId": "…",
            "externalId": "c3",
            "zone": "example.com",
            "name": "nas.example.com",
            "type": "A",
            "value": "192.168.1.20",
            "ttl": 300,
            "proxied": false,
            "recordId": null,
            "problem": null
        }
    ]
}
```

- `zone` — the zone the entry was read from; `null` for AdGuard Home.
- `readings` — per provider, when it was last read successfully, why it last failed (what it
  held before stays listed), and how many records it holds in the zones it uses. `readAt` is
  `null` before the first reading since the server started.
- `recordId` — a record of dpm with the same name, type and value in other sites; adopting the
  entry gives that record the site instead of creating another.
- `problem` — why the entry cannot be adopted, such as a name dpm does not accept.

### Adopt

`POST /api/v1/unmanaged/adopt` with `{ "siteId": "…", "entries": [{ "providerId": "…", "externalId": "…" }] }`
(at most 1000) takes the entries over into the site. The entries stay as they are; the site's
other providers get the records written, in the background. The site has to write to each
entry's provider. Each entry becomes a record with its TTL and proxy
setting, or gives the existing record the site; what cannot be taken over is refused with its
reason, and the rest goes ahead.

```json
{
    "adopted": [{ "name": "nas.example.com", "type": "A", "value": "192.168.1.20", "merged": false }],
    "refused": [{ "name": "_acme.example.com", "type": "A", "value": "192.168.1.99", "reason": "…" }]
}
```

**400** for a site that does not exist.

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

`source` is `user` for a change someone made — their name is in `data.user` — and `server` for
what the server did by itself.

| Kind | Level | `subject` | `data` |
| :--- | :---- | :-------- | :----- |
| `record.created` / `record.deleted` | `info` | `recordId` | `user`, `name`, `type`, `value`, `sites` (names) |
| `record.changed` | `info` | `recordId` | as above, and `changes` |
| `site.created` / `site.deleted` | `info` | `siteId` | `user`, `name`, `providers` (names) |
| `site.changed` | `info` | `siteId` | `user`, `name`, `changes` |
| `provider.created` / `provider.deleted` | `info` | `providerId` | `user`, `name`, `providerType` |
| `provider.changed` | `info` | `providerId` | `user`, `name`, `providerType`, `changes` |
| `record.adopted` | `info` | `recordId`, `providerId` | `user`, `name`, `type`, `value`, `sites`, `provider`, `merged` |
| `record.adoption` | `info` | `siteId` | `user`, `count`, `site`, `providers` — heads the `record.adopted` of one adoption of more than one record; they share its `correlationId` |
| `record.written` | `trace`, `info` | `recordId`, `providerId` | `name`, `type`, `value`, `provider`, `action` (`created`, `updated`, `deleted`) — one write at a provider; `info` when it worked after a failure. Shares the `correlationId` of the change that caused it |
| `record.write_failed` | `error` | `recordId`, `providerId` | `name`, `type`, `value`, `provider`, `action`, `error` — when a write that worked fails, or fails for another reason |
| `record.drift` | `warning` | `recordId`, `providerId` | `name`, `type`, `value`, `provider`, `change` (`changed`, `missing`, `disabled`), `observed` (what the provider holds, as text) — found by a reading |
| `record.corrected` | `info` | `recordId`, `providerId` | `name`, `type`, `value`, `provider`, and `user` — or `auto: true` when the provider corrects drift by itself |
| `record.accepted` | `info` | `recordId`, `providerId` | `user`, `name`, `type`, `value`, `provider` — what the provider holds was taken over; the `record.changed` that follows says how |
| `record.released` | `info` | `recordId` | `user`, `name`, `type`, `value`, `sites`, `providers` — the record was given up; `providers` are those left holding it |
| `provider.unreachable` | `warning` | `providerId` | `name`, `providerType`, `error` — once, when a provider that answered stops answering |
| `provider.recovered` | `info` | `providerId` | `name`, `providerType` — when it answers again |
| `scheduler.failed` | `error` | — | `scheduler`, `trigger`, `error` |

`changes` lists what a change changed, as `{ field, from, to }` with both values written out
as text — a site renamed since still reads as it was called then. A new secret is named as
`{ "field": "secret", "from": "stored", "to": "replaced" }` and never shown.

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
| `READINGS_UPDATE`     | `{ providerId }`                            | A provider was read. The dashboard reads the providers and the unmanaged records again. |
| `RECORDS_UPDATE`      | `{ recordIds }`                             | Records were written, or where they stand at a provider changed. The dashboard reads the records and the unmanaged records again. |
| `SCHEDULER_STATUS_UPDATE` | `{ scheduler, status }`                 | One scheduler's status, in the shape of [Scheduler Status](#scheduler-status), whenever a run starts or ends or its timer is set. |
