# Configuration

DPM is configured in two places:

| Where | What goes there |
| :---- | :-------------- |
| **Dashboard → Settings** | How often the providers are read, the retention of the activity history and the level of each event kind. Stored in the `settings` block of the server's `config.yaml`. |
| **Server `config.yaml`** | Sign-in (OIDC, sessions), port, reverse proxy — what needs a restart. |

[Environment variables](#environment-variables) override a few keys of the file.

## Server `config.yaml`

Mounted at `/app/server/config.yaml`. A commented template is
[`server/config.example.yaml`](https://github.com/stefgo/dns-provider-manager/blob/main/server/config.example.yaml).

The server checks the file on every start. A value of the wrong type or format — `hsts: "yes"`,
an invalid CIDR, `oidc.enabled: true` without an `issuer` — stops the start with exit code 1
and a log line that names the field:

```
Invalid config.yaml -- security.hsts: Invalid input: expected boolean, received string
```

Fix the value and start again. Unknown keys are kept and do not cause an error; the server
logs a warning for each one at startup (`Unknown key in config.yaml -- ignored`), so a
misspelled key does not leave its default in force unnoticed.

| Key                        | Sub-Key         | Description                                              |
| :------------------------- | :-------------- | :------------------------------------------------------- |
| `jwtSecret`                | —               | JWT signing secret. Generated on the first start.        |
| `secretKey`                | —               | Encrypts the credentials the server stores for the DNS providers. Generated on the first start; do not copy it between installations. Losing or changing it means entering every provider's credentials again. |
| `oidc`                     | `enabled`       | Enables or disables OIDC login (`true`/`false`).         |
|                            | `issuer`        | OIDC Issuer URL.                                         |
|                            | `client_id`     | OIDC Client ID.                                          |
|                            | `client_secret` | OIDC Client Secret.                                      |
|                            | `redirect_uri`  | OIDC Redirect URI: `https://<this server>/api/auth/callback`. |
| `jwtExpiresIn`             | —               | Session lifetime (e.g. `"24h"`). Defaults to `"12h"`. Sessions always expire; the dashboard signs out when they do. |
| `settings`                 | `notification_retention_days` / `_count` / `notification_cleanup_interval_hours` | Retention of the activity history (defaults 90 days, at least 500 kept, every 24 h). |
|                            | `provider_read_interval_minutes` | Minutes between two readings of every provider (default `5`); `0` reads only on request and when a provider is saved. The server reads once at every start either way. |
|                            | `activity_level_overrides` | The level an event kind is recorded with, as `kind=level` entries separated by commas, e.g. `scheduler.failed=warning`; edited under **Settings → Activity History → Event Levels**. `level` is `trace`, `info`, `warning`, `error`, or `none`, which keeps the kind out of the activity and away from the webhooks. An override applies to events from then on. Default `""`; a value that cannot be read stops the server at startup. |
| `logLevel`                 | —               | pino log level; `LOG_LEVEL` wins when set.               |
| `port`                     | —               | Listen port (default `3030`); `DPM_SERVER_PORT` wins when set. The published port: the compose port mapping has to follow it. |
| `security`                 | `trusted_proxies` | Reverse proxies whose `X-Forwarded-For` and `X-Forwarded-Proto` the server believes: IP addresses, CIDR networks (v4 or v6), or `loopback`, `linklocal`, `uniquelocal`. Empty (default) believes no one. **Behind a proxy, list it** — see [Reverse proxy](security.md#reverse-proxy). Requires a restart; `DPM_TRUSTED_PROXIES` wins. |
|                            | `hsts`          | Send `Strict-Transport-Security` (default `false`). Enable only when the dashboard is served exclusively over HTTPS — browsers remember the header for months. Requires a restart. |

On the first start the file has to be **writable**: the server writes the generated
`jwtSecret` and `secretKey` into it, and refuses to encrypt with a `secretKey` it could not
write back.

## Environment Variables

| Variable      | Values                           | Default       | Description                                                                   |
| :------------ | :------------------------------- | :------------ | :---------------------------------------------------------------------------- |
| `LOG_LEVEL`   | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `info` | Controls log verbosity. Wins over `logLevel` in `config.yaml`. |
| `LOG_FORMAT`  | `pretty`, `json`                 | _auto_        | `pretty` for coloured single-line logs (default in dev), `json` for production. |
| `DPM_SERVER_PORT` | `1`–`65535`                 | `3030`        | Port the server listens on; wins over `port` in `config.yaml`. An unusable value ends the start. The container's health check follows the port either way (see [Health](operations.md#health)). |
| `DPM_TRUSTED_PROXIES` | IPs, CIDRs, `loopback`, `linklocal`, `uniquelocal`, comma separated | _unset_ | Reverse proxies whose `X-Forwarded-*` headers the server believes; wins over `security.trusted_proxies`. An unusable entry ends the start. See [Reverse proxy](security.md#reverse-proxy). |
| `NODE_ENV`    | `development`, `production`      | `development` | Picks the log format when `LOG_FORMAT` is unset (`production` → JSON).        |
| `DPM_CLOUDFLARE_API_URL` | URL                   | _unset_       | Where Cloudflare's API is asked, in place of `https://api.cloudflare.com/client/v4`. Only for tests against a stand-in, never for an installation. |

In Compose they go into the service's `environment:` block:

```yaml
        environment:
            - NODE_ENV=production
            - LOG_LEVEL=debug
```
