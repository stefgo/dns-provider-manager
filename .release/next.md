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
with their credentials, which are stored encrypted and never shown again. Writing the records
to them comes with the next versions. Every change to a record, site or provider is in the
activity history, with who made it.
