# Operations

Running DPM once it is installed: which image to pull, how to upgrade, what to back up, and
how to tell that it is healthy.

## Images and tags

The server is published as a multi-arch image (`linux/amd64`, `linux/arm64`):
`ghcr.io/stefgo/dpm-server`.

| Tag | What it is |
| :-- | :--------- |
| `latest` | The last release. Moves only when a release is published. **Use this one** unless you have a reason not to. |
| `1.2.0` | A specific release. Pin it to make an upgrade a decision rather than a side effect of `docker compose pull`. |
| `1.2` | The newest patch release of that minor version. |
| `main` | The current state of the `main` branch — not a release, and it can be ahead of `latest`. |
| `dev` | The state of development. Expect it to break. |
| `sha-<short>` | The build of one commit on `main` or `dev`. |

An image is tagged only after CI has started it and it answered its health check.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

- **Read the [upgrade notes](upgrade-notes.md) first.** They say what a release changes and
  what an existing installation has to do about it.
- The database schema is migrated automatically when the server starts.

## Backup

| What | Where | Why |
| :--- | :---- | :-- |
| Server database | `server-data` volume (`/app/server/backend/data`) | Users, webhooks, activity — and, as they arrive, records, providers and sites |
| Server config | `server-config.yaml` | Session key, the `secretKey` that encrypts the providers' credentials, OIDC, settings — without the `secretKey` every provider's credentials have to be entered again |

The database is SQLite in WAL mode, so copy it with the server stopped:

```bash
docker compose stop dpm-server
docker run --rm -v dpm_server-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/dpm-server-data.tgz -C /data .
docker compose start dpm-server
```

(The volume name is prefixed with the compose project, usually the directory name —
`docker volume ls` shows it.)

## Health

The image declares a `HEALTHCHECK`, and `compose.yaml` repeats it, so `docker ps` shows
`(healthy)` next to the container:

```bash
curl -fsS http://localhost:3030/api/health   # process and database
```

- **The DNS providers are not consulted.** One unreachable provider must not mark the server
  as broken; the dashboard shows it instead.
- **The check follows the port the process actually listens on.** It does not read
  `config.yaml`: once the server listens, it writes the address it serves to
  `/tmp/dpm-health.json` inside its container, and the check asks that. A `port` moved in
  `config.yaml` is followed like one moved through `DPM_SERVER_PORT`.
- **Without that file the check fails** — during start-up, which `start_period` covers.
- **Docker does not restart an unhealthy container.** `restart: unless-stopped` reacts to a
  process exiting, not to its health. The state is for monitoring and for
  `depends_on: condition: service_healthy`.

## Logs

```bash
docker logs -f dpm-server
```

`LOG_LEVEL=debug` (or `logLevel` in `config.yaml`) makes the server talkative;
`LOG_FORMAT=json` for a log collector. See
[Configuration](configuration.md#environment-variables).

## Changing the port

`DPM_SERVER_PORT` / `port` move the listen port. Move the compose port mapping with it.
