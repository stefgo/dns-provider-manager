# AdGuard Home Clusters

An **AdGuard Home cluster** is one provider made of several AdGuard Home instances, its
**nodes**. One node is the **primary**; DPM reads and writes it like a single AdGuard Home and
makes every other node an exact copy of it, area by area. It is meant for instances that stand
in for each other — two resolvers behind one virtual IP, say — and should answer alike whichever
of them is asked.

For sites and records a cluster is one provider: it is added to a site like any other, a record
goes to it once, and its unmanaged entries are those of the primary.

## What is kept alike

The **DNS rewrites** are always kept alike — without them a node would not hold the records.
The other areas are chosen per cluster; each is copied whole:

| Area | In AdGuard Home |
| :--- | :-------------- |
| **DNS rewrites** | *Filters → DNS rewrites*: every rewrite, those DPM manages and the others alike, and the switch for all of them. Always on |
| **General settings** | *Settings → General settings*: filtering and the list update interval, Safe Browsing, parental control, Safe Search, the query log and the statistics settings |
| **DNS settings** | *Settings → DNS settings*: upstream, bootstrap, fallback and private reverse DNS servers, rate limit, blocking mode, cache, the access lists — and the protection switch, a running pause included. Not ticked for a new cluster |
| **Client settings** | *Settings → Client settings*: the clients set up by hand, each with every setting (identifiers, tags, own filtering and Safe Search, blocked services and their schedule, upstreams). The clients AdGuard Home finds by itself are left alone |
| **DNS blocklists** | *Filters → DNS blocklists*: the lists by URL, with their name and whether they are on |
| **DNS allowlists** | *Filters → DNS allowlists*, the same way |
| **Blocked services** | *Filters → Blocked services*, with the schedule. Needs AdGuard Home **v0.107.37** or later |
| **Custom filtering rules** | *Filters → Custom filtering rules*, as one list in the primary's order |

Not kept alike: encryption (TLS) and DHCP, which belong to each instance, and the users of the
web interface.

## Setting one up

**Providers → Add Provider**, type **AdGuard Home cluster**:

1. **Add Node** for each instance: a name, the address of its web interface, the user and the
   password. Each node signs in on its own. The first node added is the primary; another one
   becomes it with the crown in its row.
2. Under **Kept Alike**, tick the areas. All but the DNS settings are ticked to begin with.
3. **Test Connection** asks every node and says what each answered. A node that does not answer
   is a remark; the primary not answering is a failed test.
4. **Save.** Before saving, DPM reads the nodes and asks: what the next run writes to each
   node — every node of a new cluster, a node new to the cluster, an area just ticked, every
   node when the primary changes. Saving writes nothing to the nodes: the next run does, or
   **Sync Now** at once.

A cluster may have a single node, to be set up step by step; it then behaves like a single
AdGuard Home until a second node joins.

**Make changes at the primary, at its own address** — not through a virtual IP. Whatever is
changed at another node is written over with the primary's state on the next run. When a
virtual IP moves to another node, a change made through it lands on that node and is lost.

An address belongs to one cluster at most, and not to a single AdGuard Home provider besides:
the cluster's runs would write over the other's changes there.

## The cluster's page

Below the provider's details, the card **Nodes** shows every node with its version and when it
last answered, and a table of where each area stands at each node besides the primary:
**In step**, **Waiting** (not reached yet, or new), **Failed** (with the reason below the
table) or **Paused**. **Sync Now** runs the cluster at once. The provider list shows how many
nodes a cluster has and how they stand.

## Records

A record DPM writes to the cluster goes to the primary, and right after to every node whose
rewrites are in step. A node that does not take it is marked as waiting, and the next run
brings it up; the record itself counts as written. A node that is behind — new, or down — gets
the records with the next run that reaches it.

Rewrites the primary holds and DPM does not manage are copied to the nodes as well, and a
rewrite only a node holds is removed: within a cluster, *DPM leaves alone what it does not
manage* holds for the primary only.

## How a run works

The cluster runs on its own timer — every 5 minutes by default (**Settings → Providers → Cluster
Sync Interval**), once at every start of the server and on **Sync Now**. Saving a cluster
starts no run. While a cluster runs, no record is written to it.

A run reads the areas of the primary and of every other node, and per node and area:

| What it finds | What it does |
| :------------ | :----------- |
| The node holds what the primary holds | Nothing |
| The primary changed since the last run | Writes the change to every node |
| The node is behind — new to the cluster, an area just ticked, another primary, it was down, or a write failed | Brings it up |
| The node was changed at the node | **Writes it over** with the primary's state, and reports what it wrote (`cluster.corrected`, a warning) |
| The node cannot be reached | Leaves it; the next run brings it up |
| The primary cannot be reached | Writes nothing anywhere; the cluster is **paused** until it answers again (`cluster.paused`, `cluster.resumed`). Records wait as for any provider that does not answer |

After writing, DPM reads the node back: what still differs is reported as a failure.

A run that wrote the primary's state to a node leaves one entry in the activity
(`cluster.propagated`): the nodes written to, and below it the areas written, one per line. A
run that found every node in step leaves none.

## Nodes of different versions

Areas are compared on the fields **every** node knows. A field only a newer version has —
Ecosia in Safe Search, the switch for each rewrite (v0.107.68) — is not kept alike and keeps
its value at each node. An area a node's version cannot take at all (blocked services before
v0.107.37) shows as failed at that node; the other areas carry on.

## Good to know

- **Nothing is left out of an area.** Pausing protection at the primary pauses it at every node
  within a run. A path in *Upstream DNS servers from a file* and a filter list read from a
  local file have to exist on every node, or writing that field or list fails at the node that
  lacks it.
- **A freshly installed primary empties the other nodes.** Before replacing the primary, make
  another node the primary.
- **A change at the primary reaches the nodes with the next run**, within 5 minutes by default.
  If the primary goes down before that, the change stays on it and goes out once it is back.
- **A URL is either a blocklist or an allowlist** in AdGuard Home. A list moved from the
  allowlists to the blocklists at the primary needs two runs at a node, with a failed write in
  between.
- AdGuard Home has no way to write "only if unchanged": a change made at a node in the seconds
  between a run's reading and its writing can be written over unreported.
- A run reads every area of every node — a handful of small requests each, every 5 minutes
  by default. Set the interval higher, or to `0` (only on request), if that is too often.

## From single providers to a cluster

To turn AdGuard Home providers that are kept alike by hand into a cluster:

1. Delete the single providers. Deleting a provider changes nothing at the instance; its
   records stay in DPM.
2. Add the cluster with the same instances as nodes.
3. Add the cluster to the sites the single providers were in.

The cluster takes over the rewrites the primary holds already, as any provider does when a
record finds its entry there.
