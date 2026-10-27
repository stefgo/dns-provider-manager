# Security

DPM writes DNS records, and whoever can sign in can change where a name points. This page
lists what protects the server and what you have to set up yourself.

## Checklist

- The `admin` / `admin` password is changed ([Quick Start](quickstart.md#2-sign-in)).
- The server is reachable only through a reverse proxy with TLS, and that proxy is listed in
  `security.trusted_proxies` ([below](#reverse-proxy)).
- `server-config.yaml` and the `server-data` volume are backed up separately and readable
  only by the server's user ([below](#what-is-stored-where)).

## Sign-in

- Local accounts (bcrypt) and OIDC single sign-on (`oidc` in the
  [server's `config.yaml`](configuration.md#server-configyaml)).
- Sessions are an httpOnly cookie that expires after `jwtExpiresIn` (default 12 h); the
  dashboard signs out when it does.
- Changing a user's password or auth methods, or deleting the user, ends all of that user's
  sessions at once, open dashboards included.
- `POST /api/login` accepts at most **10 attempts per 15 minutes** per client IP.
- The **status token**, when one is configured (`statusToken`, `DPM_STATUS_TOKEN`), is the one way in without an account. It opens `GET /api/v1/status` and nothing else -- the dashboard's verdict and its findings, which name records and providers -- and changes nothing. It is compared in constant time, and the route answers at most 60 requests a minute per address. Like `jwtSecret` it is kept in plain text; give it as `DPM_STATUS_TOKEN_FILE` to keep it out of `config.yaml`, and change it by changing the value and restarting.

## Reverse proxy

The server believes `X-Forwarded-For` and `X-Forwarded-Proto` only from the proxies listed in
`security.trusted_proxies` (or `DPM_TRUSTED_PROXIES`). The list is empty by default, so the
client address is the connection's own and a caller cannot choose it by sending the header —
port 3030 can be published directly.

**Behind a proxy, list it:**

```yaml
security:
    # A proxy on the same host:
    trusted_proxies: ["loopback"]
    # A proxy container on a Docker network (its address is assigned by Docker):
    # trusted_proxies: ["uniquelocal"]
```

Without the entry nothing fails outright, but two things go wrong quietly:

- Every request appears to come from the proxy. The login rate limit then counts all users
  together.
- The session cookies lose `Secure`, because the server sees the proxy's plain-HTTP
  connection rather than the browser's HTTPS one.

The startup log says which proxies are trusted, or that none are.

The proxy has to pass WebSockets (`/ws/dashboard`) and should send `X-Forwarded-Proto`, so the
session cookies are marked `Secure`.

## Security Headers

The server sends a Content-Security-Policy and the usual hardening headers (via
`@fastify/helmet`). The policy allows scripts, styles and fonts only from the server itself,
and WebSocket connections to the same host. The font ships with the bundle, so no other origin
is named. If a reverse proxy injects scripts or other resources into the dashboard, those are
blocked.

`Strict-Transport-Security` is **off** unless `security.hsts: true` is set, because many
installations run on plain HTTP. Behind TLS, either enable it here or let the reverse proxy
send it.

## What is stored where

| Secret | Stored in |
| :----- | :-------- |
| User passwords | the server's SQLite database (`server-data` volume), as bcrypt hashes |
| Credentials of the DNS providers | the server's SQLite database, encrypted (AES-256-GCM) with `secretKey` — the server presents them to the providers, so it has to read them back |
| Session signing key (`jwtSecret`), encryption key (`secretKey`), OIDC client secret, status token (`statusToken`) | the server's `config.yaml` (the status token also as `DPM_STATUS_TOKEN` or a file named by `DPM_STATUS_TOKEN_FILE`) |

The database and `config.yaml` are kept apart on purpose — a volume and a bind-mounted file —
so a copy of the volume alone contains no usable provider credential. Back them up separately.

## Container user

The server process runs as the unprivileged user `node` (UID 1000), not as root. The
container starts as root only for a moment: its entrypoint hands the data volume and, when the
server cannot write it, the mounted `server-config.yaml` to UID 1000, then drops to that
user. `server-config.yaml` on the host may afterwards belong to UID 1000. Check with
`docker top dpm-server`, not `docker exec … id`: `exec` starts its shell as root.

To pick the UID yourself, set `user: "1234:1234"` on the service. The entrypoint then changes
nothing, and the volume and the config file have to be writable by that UID — otherwise the
server stops at start-up and names the directory it cannot write.
