<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### The first version

DNS Provider Manager keeps A, AAAA and CNAME records in one place, for the DNS servers that
should answer for them. This first version brings the server and its interface: sign-in with
local accounts or OpenID Connect, user management, the activity history, webhooks and the
settings.

### Records, sites and providers

Records are kept with the sites they belong to — a site is a group of DNS servers that give
the same answers, such as *internal* and *external*. The same name may have another answer in
another site. A record that would clash with another is refused before it is stored: the same
record twice, or a CNAME next to another record of its name on the same DNS server.

Providers — a Cloudflare API token, an AdGuard Home instance, a Samba AD domain — are set up
with their credentials, which are stored encrypted and never shown again. Every change to a
record, site or provider is in the activity history, with who made it.

### Bring your existing records along

Every provider is read every few minutes (adjustable under *Settings → Providers*), and
nothing is written to it: the zones of a Cloudflare token and the A, AAAA and CNAME records in
them, the DNS rewrites of an AdGuard Home instance, and the zones of a Samba AD domain — without
the records its domain controllers register for themselves. What the providers hold and DNS
Provider Manager does not manage yet is listed under *Unmanaged* and can be adopted into a
site — picked entries, or all at once.

Several API tokens may see the same zone; each zone is used by one provider only. A provider
can use every zone its token sees, or only the ones ticked in its editor, and *Test
Connection* tries a token before it is saved. When a provider stops answering, and when it
answers again, the activity history says so.

What each kind of provider needs is described in the documentation's new *Providers* page —
mind that AdGuard Home locks an address out for a while after a few wrong passwords. Writing
to the DNS servers comes with the next versions.
