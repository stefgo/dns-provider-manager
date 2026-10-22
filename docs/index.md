# DNS Provider Manager (DPM)

The same host name often has to be answered by more than one DNS server: a public record at
Cloudflare, the same name with an internal address on every AdGuard Home instance at home,
maybe a record in the Active Directory's own DNS. Kept by hand, those copies drift apart, and
nobody knows any more which of them is the one that counts.

**DNS Provider Manager (DPM) keeps A, AAAA and CNAME records in one place and writes them to
the DNS servers that should answer for them.** Each record belongs to one or more *sites* — a
site is a group of providers that give the same answers, such as `internal` (two AdGuard Home
instances and Samba AD) and `external` (Cloudflare). DPM writes a record to every provider of
its sites, notices when a provider's copy has been changed behind its back, and leaves alone
what it does not manage.

> **In development.** DPM is being built in milestones. The current state is the server with
> sign-in, users, the activity history, webhooks and settings; records, providers and sites
> follow.

## How the pieces fit together

| | What it holds | Talks to |
|---|---|---|
| **DPM server** | Users, settings, the records and where they belong, the activity history — in SQLite | the browser, the DNS providers |
| **DNS provider** | The records it answers with | DPM, over its own API |

There is no agent: Cloudflare is reached over its HTTPS API, AdGuard Home over its HTTP API,
Samba AD over LDAPS — all from the server.

## Where to go next

- [Quick Start](quickstart.md) — the server with Docker Compose, the first sign-in.
- [Configuration](configuration.md) — the server's `config.yaml` and the environment variables.
- [Security](security.md) and [Operations](operations.md) — reverse proxy, backup, health.
- [Webhooks](webhooks.md) — report events to a chat or a script.
- [REST & WebSocket API](api.md) — what the dashboard itself uses.
