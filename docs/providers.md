# Providers

A provider is one access to a DNS server: a Cloudflare API token, an AdGuard Home instance, a
Samba AD domain. It is added under **Providers**; **Test Connection** asks it before anything
is saved. Which sites a provider belongs to is set in each site.

DPM reads every provider every few minutes (*Settings → Providers*), once at every start and
whenever a provider is saved. Reading changes nothing at the provider. What it holds and DPM
does not manage is listed under **Unmanaged**, to be adopted into a site.

DPM reads A, AAAA and CNAME records only; every other type stays as it is and is not listed.

## Cloudflare

| Field | |
| :---- | :-- |
| API Token | A token with the permissions **Zone · Zone · Read** and **Zone · DNS · Edit** — for all zones, or only the ones DPM may use. *Edit* is what writing will need; reading needs only *Read*. |
| Zones | **All zones the token sees**, new ones included, or **Selected zones**, ticked in the editor once the provider has been read. |

Several tokens may see the same zone — another account's token, or a second token of one
account. A zone is used by one provider only: one that ticks it under *Selected zones* wins
over one that merely sees it; otherwise the provider added first keeps it. The editor lists
the zones and who uses each.

Cloudflare's *Auto* TTL is read as the provider's default; the proxy setting (the orange
cloud) is kept with the record.

## AdGuard Home

| Field | |
| :---- | :-- |
| URL | Where AdGuard Home's web interface answers, e.g. `http://192.168.1.2:3000`. |
| User, Password | An account of the web interface. |
| Accept a Self-Signed Certificate | For an `https://` URL whose certificate this server cannot verify. |

DPM reads the **DNS rewrites** (*Filters → DNS rewrites*). AdGuard Home has no zones: a rewrite
may be for any name, wildcards (`*.lab.home.lan`) included. The type follows from the answer —
an IPv4 address is an A record, an IPv6 address an AAAA record, a name a CNAME. A rewrite
that is switched off, and one whose answer is `A` or `AAAA` (AdGuard Home's "answer this from
upstream"), are left alone. AdGuard Home has no TTL per rewrite.

**A wrong password locks DPM out for a while.** After five failed logins AdGuard Home refuses
every login from that address for 15 minutes, the right password included (`auth_attempts`,
`block_auth_min` in `AdGuardHome.yaml`). Test a new password with *Test Connection* before
saving it, and do not try again and again.

Tested with AdGuard Home v0.107.79.

## Samba AD

| Field | |
| :---- | :-- |
| Domain Controllers | One per line, `host` or `host:port`, asked over LDAPS in this order — the first that answers is used. Port 636 unless one is named. |
| Service Account | `user@domain` or a DN. Reading needs an ordinary account of the domain. |
| Password | The account's password. |
| Accept a Self-Signed Certificate | Samba's own certificate is self-signed; switch this on unless the domain controllers carry one this server trusts. |

DPM reads the zones of the domain's two DNS partitions (and of `CN=System`, in a domain
upgraded from an old one), and the A, AAAA and CNAME records in them. **What the domain
controllers register for themselves is left out**, and can neither be listed nor adopted:

- the zone itself (`@`: its SOA, name servers and the addresses of the domain),
- every name with a label that starts with `_` (`_ldap._tcp`, `_kerberos._udp`, …),
- `DomainDnsZones`, `ForestDnsZones` and `gc`,
- the A and AAAA records under a domain controller's own name,
- the zone `_msdcs.<forest>`, and the reverse zones (`in-addr.arpa`, `ip6.arpa`).

Records a client registered for itself (dynamic updates) are listed like any other.

These are the rules [samba-ad-manager](https://github.com/stefgo/samba-ad-manager) protects the
same records with.
