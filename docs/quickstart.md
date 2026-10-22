# Quick Start

DPM is one container: the server, which serves the dashboard and talks to the DNS providers
itself. This page starts it with Docker Compose and signs in for the first time.

## 1. Start the server

Create a directory, an empty configuration file and a `compose.yaml`:

```bash
mkdir dpm && cd dpm
touch server-config.yaml
curl -fsSLo compose.yaml https://raw.githubusercontent.com/stefgo/dns-provider-manager/main/compose.yaml
docker compose up -d
```

The file has to exist before the first start, or Docker mounts a directory in its place. The
server fills it on the first start with the two keys it generates (`jwtSecret`,
`secretKey`) — keep it with your backup, see [Operations](operations.md#backup).

The dashboard is at `http://<host>:3030`. To put it behind a reverse proxy with TLS, see
[Security](security.md#reverse-proxy).

## 2. Sign in

Sign in as `admin` with the password `admin`, then change the password under **Users**. The
server logs a warning on every start until it has been changed.

Further accounts are created under **Users**; sign-in through an OpenID Connect provider is
set up in the [configuration](configuration.md#server-configyaml).

## What next

- [Webhooks](webhooks.md) report what DPM records to a chat or a script.
- [Configuration](configuration.md) lists everything the server reads.
