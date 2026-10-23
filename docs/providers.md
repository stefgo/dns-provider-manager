# Providers

A provider is one access to a DNS server: a Cloudflare API token, an AdGuard Home instance, a
Samba AD domain. It is added under **Providers**; **Test Connection** asks it before anything
is saved. Which sites a provider belongs to is set in each site.

DPM reads every provider every few minutes (*Settings → Providers*), once at every start and
whenever a provider is saved. What it holds and DPM does not manage is listed under
**Unmanaged**, to be adopted into a site.

DPM reads A, AAAA and CNAME records only; every other type stays as it is and is not listed.

## Writing

A record is written to every provider of its sites when it is saved. The editor shows
beforehand what saving does at each one — write, change, remove, take over an entry that is
there already — and asks before a provider loses the record. In the list of records, a dot per
provider shows where the record stands there:

| Dot | |
| :-- | :-- |
| green | The provider holds the record as DPM wrote it. |
| grey | Not written yet: the provider is read only, or was not read yet. |
| red | Writing failed. It is tried again after the provider's next reading. |
| amber | Changed or deleted at the provider — **drift**. *Write again* puts DPM's value back; *Take over* makes the provider's value the record's (a changed value then goes to the record's other providers too; a deletion takes the record out of the sites it reached that provider through, and parks it when none is left). |
| blue | Being removed. |

- **Only what DPM manages is touched.** DPM changes and deletes only entries it wrote or took
  over. Everything else is left as it is.
- **A move removes last.** A record that leaves a provider — it changed its sites, or a site
  lost the provider — is removed there only once every provider it still goes to holds it.
- **A deleted record** is removed from every provider that holds it; one that cannot be
  reached keeps it until it can, and the list of records says so.
- **A parked record** — one without a site — stays in DPM and is removed from every provider
  that holds it. Given a site again, it is written again. Deleting a site parks the records
  that belonged to it alone.
- **Drift** is found by the readings. With **Correct Drift by Itself** on, a provider gets DPM's
  value written back without asking.
- **Read Only** keeps DPM from writing to a provider at all — it is read and compared all the
  same. Switch it on to look at what DPM would do before it does it; records wait until it is
  switched off.
- **Adopting** an entry leaves it as it is. The site's other providers get the record written.
- **Releasing** a record is the way back: DPM deletes it and leaves every provider as it is.
  What they hold of it is unmanaged again.

## Cloudflare

| Field | |
| :---- | :-- |
| API Token | A token with the permissions **Zone · Zone · Read** and **Zone · DNS · Edit** — for all zones, or only the ones DPM may use. A token with *DNS · Read* instead of *Edit* is enough for a provider that is read only. |
| Zones | **All zones the token sees**, new ones included, or **Selected zones**, ticked in the editor once the provider has been read. |

Several tokens may see the same zone — another account's token, or a second token of one
account. A zone is used by one provider only: one that ticks it under *Selected zones* wins
over one that merely sees it; otherwise the provider added first keeps it. The editor lists
the zones and who uses each.

A record goes to the provider whose zone holds its name — with nested zones the closest one.
A site whose providers all have zones, none of which holds the name, refuses the record.

Cloudflare's *Auto* TTL is read and written as the provider's default; the proxy setting (the
orange cloud) is kept with the record. While a record is proxied, Cloudflare sets its TTL to
*Auto*, and DPM does not count that as drift. A comment or tags set at Cloudflare stay as they
are.

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

DPM writes rewrites through the same API: it adds, changes and removes them, and switches a
rewrite that was switched off on again when it writes it. AdGuard Home tells a rewrite only by
its name and answer, so a rewrite whose answer was changed there shows as drift with the new
answer. **DPM needs AdGuard Home v0.107.33 or later**; *Test Connection* refuses an older one.
It also says when all rewrites are switched off in AdGuard Home's settings.

**A wrong password locks DPM out for a while.** After five failed logins AdGuard Home refuses
every login from that address for 15 minutes, the right password included (`auth_attempts`,
`block_auth_min` in `AdGuardHome.yaml`). Test a new password with *Test Connection* before
saving it, and do not try again and again.

Tested with AdGuard Home v0.107.79; the calls DPM writes with were tried against v0.107.33.

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

DPM does not write to Samba AD yet: its records are compared, and those meant for it wait
as *not written yet*.
