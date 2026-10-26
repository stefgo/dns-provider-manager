## 1.0.0 (2026-10-26)

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
its providers, each of them named in the badge's tooltip. The list can be narrowed to one
site or the parked records, and to the records that are in sync, have a problem somewhere, or
are still being written or removed. Several records can be picked in the list and given or
taken sites together; the dialog shows which sites all, some or none of them have, and asks
before saving, saying which providers get or lose records and which records would be parked. Before saving, the
editor shows what will happen at which provider, and it asks before a record is removed from
one. A record that moves to another site, say from Cloudflare to the AdGuard Home instances, is
removed from the old provider only once the new ones hold it. A provider that cannot be reached
keeps its share until it can: the write is tried again after its next reading, and a record
deleted meanwhile is listed until it is gone there too. Adding a provider to a site writes the
site's records to it; taking one out removes them — the site's editor says how many first.

TTL and Cloudflare's proxy are set per provider, in the record's editor: a table of the
providers it goes to shows where the record stands at each, what saving would do there, and
its TTL and proxy. A record can be proxied at one Cloudflare account and not at another, with
a TTL of its own at each. AdGuard Home has no TTL per record, so its row leaves both empty.
Adopting an entry and taking over a changed TTL or proxy set it for that provider alone.

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

### A dashboard that says what needs a look

The start page sums up how DNS is doing — *Healthy*, *Degraded* or *Critical* — and lists
what needs a look: a provider that cannot be reached, a record that could not be written or
removed, a record changed or deleted at a provider, a site without a provider. Each line leads
to where it can be dealt with, and goes by itself once the problem is solved. Below, a tile
per site shows its providers, whether each answered at its last reading, and how many of its
records have a problem. The Providers entry in the sidebar carries a red dot while one of them
cannot be reached.

### Bring your existing records along

Every provider is read every few minutes (adjustable under *Settings → Providers*): the zones
of a Cloudflare token and the A, AAAA and CNAME records in them, the DNS rewrites of an AdGuard
Home instance, and the zones of a Samba AD domain — without the records its domain controllers
register for themselves. *Read Now*, on the list of providers and under *Unmanaged*, reads
them all at once instead of waiting. What the providers hold and DNS Provider Manager does not manage yet is
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

### Features

* Adopt an unmanaged entry from its row ([404535f](https://github.com/stefgo/dns-provider-manager/commit/404535fcf77a8d12c65bdd2cbff52c4433c3dee5))
* Change the sites of several records at once ([71bbb22](https://github.com/stefgo/dns-provider-manager/commit/71bbb22b77facdc5b260d06e6f3f3c453b3f1294))
* Confirm a change of the sites of several records ([8b30d30](https://github.com/stefgo/dns-provider-manager/commit/8b30d300d981fd5e05d69732922c95470db52a8e))
* Drop the target column from the provider list ([202f9cc](https://github.com/stefgo/dns-provider-manager/commit/202f9cce504c480ed19b46ef626a23db6177da7e))
* Drop the zone count from the Last Reading column ([f181251](https://github.com/stefgo/dns-provider-manager/commit/f18125172e7674023f3eb423d4f0b9f98009ad75))
* Filter the list of records by site and provider status ([4e29938](https://github.com/stefgo/dns-provider-manager/commit/4e2993860c31e3cb84f4e56bd1549b5feddefdc4))
* Give dpm a compass needle as its logo, on red ([744c356](https://github.com/stefgo/dns-provider-manager/commit/744c35654f54f5f44e0be3b7763ae75930fca823)), closes [#c0303f](https://github.com/stefgo/dns-provider-manager/issues/c0303f) [#9a2532](https://github.com/stefgo/dns-provider-manager/issues/9a2532)
* Head the save preview "Changes to providers" ([6f5bdec](https://github.com/stefgo/dns-provider-manager/commit/6f5bdecc1fc54d316f28aa3768c67d25ec436ac5))
* Keep the list of sites open in the record editor ([7bf081c](https://github.com/stefgo/dns-provider-manager/commit/7bf081cb815aa7c6babdec3a54012c23774e4aec))
* Leave the TTL column out of the list of records ([796235d](https://github.com/stefgo/dns-provider-manager/commit/796235d6423a45b5e5a2fdef795ef00383d6c689))
* Leave TTL and Cloudflare's proxy out of the record editor ([35c1588](https://github.com/stefgo/dns-provider-manager/commit/35c158825bf29a9138ca3cd9e22b3cad39ebf486))
* List Providers above Unmanaged in the sidebar ([b53a319](https://github.com/stefgo/dns-provider-manager/commit/b53a319a9dd3c237267e6886bd0b6182100c3759))
* List Sites below Providers in the sidebar ([d546744](https://github.com/stefgo/dns-provider-manager/commit/d546744bed59768eb68fb2fb1fd759d6be2aa0a7))
* List Unmanaged before Records in the sidebar ([2a124a1](https://github.com/stefgo/dns-provider-manager/commit/2a124a191480e34cd38c63ac11a50cfd9e86f203))
* Manage records, sites and providers ([b39a5fd](https://github.com/stefgo/dns-provider-manager/commit/b39a5fd1e55526c82508e5dda605a0c61f707ae1))
* Open a provider's page from its row ([522a493](https://github.com/stefgo/dns-provider-manager/commit/522a493a54cc60089b4f10026af3debad4277736))
* Park a record that has no site ([e064c83](https://github.com/stefgo/dns-provider-manager/commit/e064c838096c339354756e340b3eb3f399febc4a))
* Pick a record's sites the way a site picks its providers ([ebcfb49](https://github.com/stefgo/dns-provider-manager/commit/ebcfb49e4ab28d35f94590bee4bb6e1a31705dfc))
* Pick a site's providers the way pbcm picks a job's repository ([5df1b0a](https://github.com/stefgo/dns-provider-manager/commit/5df1b0a90f7a6e2e9ca30d42a2e9a9bb378038ef))
* Pick the sites of several records from the editor's list ([e1089a3](https://github.com/stefgo/dns-provider-manager/commit/e1089a3b2716dfacdc5d3479c2742a95e1df704c))
* Read AdGuard Home and Samba AD ([76030ef](https://github.com/stefgo/dns-provider-manager/commit/76030ef62427ae887482e3fd0d2380cdaea10db9))
* Read Cloudflare and adopt what it holds ([7f85be8](https://github.com/stefgo/dns-provider-manager/commit/7f85be8571d544ee07d3939203141184a5f26c85))
* Read every provider from the list of providers ([7fdd508](https://github.com/stefgo/dns-provider-manager/commit/7fdd50824a5dbd9469fb80388d1ae199d88841cf))
* Release a record back to unmanaged ([71d1621](https://github.com/stefgo/dns-provider-manager/commit/71d1621edb7c562662947fe0271a2f90934d01b2))
* Set Records apart in the sidebar ([a5ee819](https://github.com/stefgo/dns-provider-manager/commit/a5ee819df9e5cfafcefe5ae9f39f5d39cc23e978))
* Set the administration apart from the activity in the sidebar ([4f0fc5c](https://github.com/stefgo/dns-provider-manager/commit/4f0fc5cb0ef9e37a2245f1edc6a0dcc95af13a13))
* Set TTL and Cloudflare's proxy per provider ([45b72d0](https://github.com/stefgo/dns-provider-manager/commit/45b72d0c8ce3cf88ba61c531c477c5579e683e4d))
* Set up the server with sign-in, activity, webhooks and settings ([f1f5c3f](https://github.com/stefgo/dns-provider-manager/commit/f1f5c3ff015db481e2b0656fa29ac7b1b944cce6))
* Show a record's providers as a table in its editor ([ef18a0f](https://github.com/stefgo/dns-provider-manager/commit/ef18a0ffe517e6adf90bf26a9e6342f43086fe62))
* Show a record's state at its providers as one badge ([bf9c321](https://github.com/stefgo/dns-provider-manager/commit/bf9c321a08d3f2c0e58606bde133cec3edead500))
* Show how DNS is doing on the dashboard ([ceee7e4](https://github.com/stefgo/dns-provider-manager/commit/ceee7e4f25484ff32aa9bb2b6858a9e842bc2776))
* Show names and values of records in the regular font ([3a370df](https://github.com/stefgo/dns-provider-manager/commit/3a370dffeb3b73cad4b59fa2e66fa464b658c917))
* Show the zone of an unmanaged entry beside its provider ([8519c5c](https://github.com/stefgo/dns-provider-manager/commit/8519c5c3fdc9af315ab4b440418a2d2bd9f5fb2e))
* Show whether a provider can be read with a dot in its row ([d4f2276](https://github.com/stefgo/dns-provider-manager/commit/d4f22768df3720aae94ecbc2b74c9bb3c01bbac6))
* Write records to Cloudflare and AdGuard Home, and report drift ([5c08d7d](https://github.com/stefgo/dns-provider-manager/commit/5c08d7d19f4778f40ceb1f3d1e56fcf478c0bd7d))

### Bug Fixes

* Align the site and provider pickers with the other fields ([e4e130f](https://github.com/stefgo/dns-provider-manager/commit/e4e130fcd96c6df272ece1e9507703da75430653))
* Ask for no save preview while a new record is incomplete ([bc5a609](https://github.com/stefgo/dns-provider-manager/commit/bc5a609a54a6bbb26fa0d30dd262e01a11edb963))
* Show a provider's details in the regular font ([ad3d30d](https://github.com/stefgo/dns-provider-manager/commit/ad3d30daa4cbabefab67d238215741210c3494be))
