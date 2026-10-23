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
another site. A record that would clash is refused before it is stored: the same record twice,
or a CNAME next to another record of its name on the same DNS server — whether that one is
DNS Provider Manager's or only the server's.

Providers — a Cloudflare API token, an AdGuard Home instance, a Samba AD domain — are set up
with their credentials, which are stored encrypted and never shown again. A dot in front of
each provider's name says whether its last reading worked. A click on a provider's row opens
its page: where it is reached, how its last reading went, the zones it uses and how many
records go to it. Every change to a record, site or provider is in the activity history, with
who made it.

### Records are written to Cloudflare and AdGuard Home

Saving a record writes it to every provider of its sites — Cloudflare and AdGuard Home — and
the list of records shows with one badge where it stands — the most urgent state at any of
its providers, each of them named in the badge's tooltip. Before saving, the
editor shows what will happen at which provider, and it asks before a record is removed from
one. A record that moves to another site, say from Cloudflare to the AdGuard Home instances, is
removed from the old provider only once the new ones hold it. A provider that cannot be reached
keeps its share until it can: the write is tried again after its next reading, and a record
deleted meanwhile is listed until it is gone there too. Adding a provider to a site writes the
site's records to it; taking one out removes them — the site's editor says how many first.

TTL and Cloudflare's proxy are set per provider, in the record's editor next to each provider
it goes to: a record can be proxied at one Cloudflare account and not at another, with a TTL
of its own at each. AdGuard Home has no TTL per record and shows no setting. Adopting
an entry and taking over a changed TTL or proxy set it for that provider alone.

A record can be parked: without a site it stays in DNS Provider Manager, marked *Parked* in the
list, and is removed from every provider until it gets a site again. Deleting a site parks the
records that belonged to it alone, and so does taking over a deletion that leaves a record
without a site.

DNS Provider Manager changes and deletes only what it wrote or adopted. A provider can be set to
*read only*: it is read and compared, never written — a safe way to look at what would happen
first.

### Drift

When a record is changed or deleted at a provider behind DNS Provider Manager's back, the next
reading reports it, in the list of records and in the activity history. *Write again* puts the
record back; *Take over* makes the provider's value the record's. A provider can be set to
correct drift by itself.

### Bring your existing records along

Every provider is read every few minutes (adjustable under *Settings → Providers*): the zones
of a Cloudflare token and the A, AAAA and CNAME records in them, the DNS rewrites of an AdGuard
Home instance, and the zones of a Samba AD domain — without the records its domain controllers
register for themselves. What the providers hold and DNS Provider Manager does not manage yet is
listed under *Unmanaged* and can be adopted into a site — one at a time, or several picked
together. The entries stay as they are; the site's other providers get the records written.
*Release* is the way back: DNS Provider Manager lets go of a record and leaves every provider
as it is, so what they hold is unmanaged again.

Several API tokens may see the same zone; each zone is used by one provider only. A provider
can use every zone its token sees, or only the ones ticked in its editor, and *Test
Connection* tries a token before it is saved. When a provider stops answering, and when it
answers again, the activity history says so.

What each kind of provider needs is described in the documentation's new *Providers* page —
mind that AdGuard Home locks an address out for a while after a few wrong passwords. AdGuard
Home has to be v0.107.33 or later; a Cloudflare token needs *DNS · Edit* to be written to.
Samba AD is read and compared; writing to it comes with a later version.
