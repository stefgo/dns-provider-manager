# DNS Provider Manager (DPM)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org/) ![Build Workflow](https://github.com/stefgo/dns-provider-manager/actions/workflows/build.yml/badge.svg)

<img src="docs/assets/favicon.svg" alt="" width="72" align="right">

The **DNS Provider Manager** (DPM) keeps A, AAAA and CNAME records in one place and writes
them to the DNS servers that should answer for them — Cloudflare for what the internet sees,
any number of AdGuard Home instances and, where there is one, Samba AD for the internal
network. A record belongs to one or more **sites**, groups of providers that give the same
answers; split horizon is the same name in two sites with two answers.

> **In development.** Records, sites and providers can be managed; Cloudflare is read and
> what it holds can be adopted. Writing to the DNS servers follows.

## 🚀 Planned features

- **One record, many DNS servers:** a record is written to every provider of its sites. A new
  AdGuard Home instance in a site receives every record of that site without touching one.
- **Cloudflare, AdGuard Home, Samba AD:** over their own APIs — HTTPS, HTTP and LDAPS. There
  is no agent to install.
- **Takes over what is there:** records a provider already holds are shown as *unmanaged* and
  can be taken over one by one or in bulk — the way today's Cloudflare records move into DPM.
- **Drift:** a record changed or deleted at the provider behind DPM's back is reported, with
  the choice to write DPM's value again or to take over the provider's.
- **Leaves the rest alone:** DPM deletes only what it created or took over.

Available today:

- **Records, sites and providers:** A, AAAA and CNAME records with the sites they go to,
  checked for conflicts — the same record twice, a CNAME beside another record of its name.
  Provider credentials are stored encrypted and never shown again.
- **Cloudflare, read:** the zones of every token and the records in them. What dpm does not
  manage yet is listed as *unmanaged* and adopted into a site, one by one or all at once.
  Several tokens may see the same zone; it is used by one of them.
- **Authentication:** local accounts and OIDC (OpenID Connect), configurable per user.
- **Activity history and webhooks:** every event, filtered by level and kind, to a chat
  channel or an endpoint of your own with a JSON body template.
- **Real-time:** the dashboard is updated over a WebSocket.

## 🏗 Architecture

A monorepo with three workspaces:

1. **Server Backend (`server/backend`):** a Fastify API server — users, settings, the records
   and where they belong, the activity history (SQLite), and the connections to the DNS
   providers.
2. **Server Frontend (`server/frontend`):** a React SPA built with Vite, Tailwind CSS and
   [`@stefgo/react-ui-components`](https://github.com/stefgo/react-ui-components).
3. **Shared Library (`shared`):** TypeScript types, Zod schemas and constants used by both.

## 🐳 Quick Start

```bash
mkdir dpm && cd dpm
touch server-config.yaml
curl -fsSLo compose.yaml https://raw.githubusercontent.com/stefgo/dns-provider-manager/main/compose.yaml
docker compose up -d
```

The dashboard is at `http://localhost:3030`, user `admin`, password `admin` — change it
after the first sign-in. See the [Quick Start](docs/quickstart.md) for more.

## 📚 Documentation

The documentation is published at <https://stefgo.github.io/dns-provider-manager/> and lives
in [`docs/`](docs/):

- [Quick Start](docs/quickstart.md) · [Configuration](docs/configuration.md)
- [Security](docs/security.md) · [Operations](docs/operations.md) · [Upgrade Notes](docs/upgrade-notes.md)
- [Webhooks](docs/webhooks.md) · [REST & WebSocket API](docs/api.md)
- [Backend](docs/backend.md) · [Frontend](docs/frontend.md) · [Development](docs/development.md)

## 📄 License

[MIT](LICENSE)
