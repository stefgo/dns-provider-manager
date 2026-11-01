<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### Read the status from elsewhere

`GET /api/v1/status` answers with what the dashboard shows -- the verdict (`healthy`,
`degraded`, `critical`, `unknown`) and every line of **Needs attention** with the dashboard's
text -- for Home Assistant, a monitoring system or a script. Besides a session it
takes a status token that opens this route and nothing else: set `statusToken` in
`config.yaml` or `DPM_STATUS_TOKEN` (`_FILE`), at least 32 characters. Without one
nothing changes. See [Status](https://stefgo.github.io/dns-provider-manager/api/#status).

### AdGuard Home clusters

A new provider type, **AdGuard Home cluster**, makes several AdGuard Home instances one
provider. One node is the **primary**; the other nodes become exact copies of it. The DNS
rewrites are always copied — every rewrite, not only those DPM manages — and, chosen per
cluster, general settings, DNS settings, client settings, DNS blocklists, DNS allowlists,
blocked services and custom filtering rules. Add the nodes in the provider editor the way a
site lists its providers, and mark the primary with the crown.

A record goes to the primary and right away to the other nodes. A change at the primary
reaches them with the next run, every 5 minutes by default (**Settings → Providers → Cluster
Sync Interval**), or at once with **Sync Now** on the cluster's page; **Check** next to it shows what differs at
each node without writing anything. A change made at another
node is written over and reported as a warning, so make changes at the primary's own address,
not through a virtual IP. Before saving, the editor shows what each node is about to get;
saving itself writes nothing to the nodes. While the primary cannot be reached nothing is
written. Blocked services need AdGuard Home v0.107.37 or later on every node. The new activity
kinds start with `cluster.` and can be sent to a webhook like any other. See
[AdGuard Home Clusters](https://stefgo.github.io/dns-provider-manager/clusters/).

Existing providers stay as they are; the database is updated by itself at the first start.
