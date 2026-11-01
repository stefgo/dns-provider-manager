import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/AppConfig.js", () => ({
    appConfig: { secretKey: "test-secret-key", settings: { activity_level_overrides: "" } },
    secretKeyPersisted: () => true,
}));
vi.mock("../core/Database.js", async () => {
    const { migratedMemoryDatabase } = await import("../testing/memoryDatabase.js");
    return { default: await migratedMemoryDatabase() };
});
vi.mock("./ProviderReadService.js", () => ({
    ProviderReadService: { readSoon: () => undefined, forget: () => undefined, entries: () => new Map(), readings: () => [], patch: () => undefined },
}));

/**
 * Stand-ins for the AdGuard Home instances, by node name: three areas of their configuration,
 * which are down, which refuse writes, and every write made to them.
 */
const world = vi.hoisted(() => ({
    rewrites: new Map<string, string[]>(),
    general: new Map<string, Record<string, number>>(),
    clients: new Map<string, string[]>(),
    down: new Set<string>(),
    refusing: new Set<string>(),
    writes: [] as string[],
    versions: new Map<string, string>(),
}));

vi.mock("../providers/clients.js", () => ({
    clientFor: () => ({ zoned: false, listZones: async () => [], listRecords: async () => [], close: async () => undefined }),
    adguardApiFor: (node: { name: string }) => ({
        name: node.name,
        version: async () => {
            if (world.down.has(node.name)) throw new Error(`${node.name} could not be reached`);
            return world.versions.get(node.name) ?? "v0.107.79";
        },
    }),
}));

/** Three areas as simple as the service needs: two lists of names, one of fields. */
vi.mock("../providers/configAreas.js", () => {
    type Api = { name: string };
    const refuse = (api: Api) => {
        if (world.refusing.has(api.name)) throw new Error(`${api.name} refused it`);
    };
    const list = (area: string, store: Map<string, string[]>, minVersion: string | null) => ({
        area,
        minVersion,
        read: async (api: Api) => [...(store.get(api.name) ?? [])],
        normalise: (raw: unknown) => [...(raw as string[])].sort(),
        diff: (target: string[], current: string[]) => (target.join() === current.join() ? [] : [target]),
        apply: async (api: Api, steps: string[][]) => {
            refuse(api);
            for (const names of steps) {
                world.writes.push(`${api.name} ${area}=${names.join(",")}`);
                store.set(api.name, names);
            }
        },
        describe: (names: string[]) => `${area} set to ${names.join(", ")}`,
    });
    const general = {
        area: "general",
        minVersion: null,
        read: async (api: Api) => ({ ...world.general.get(api.name) }),
        normalise: (raw: unknown) => raw,
        diff: (target: Record<string, number>, current: Record<string, number>) =>
            Object.keys(target)
                .filter((key) => target[key] !== current[key])
                .map((key) => ({ key, value: target[key] })),
        apply: async (api: Api, steps: { key: string; value: number }[]) => {
            refuse(api);
            for (const { key, value } of steps) {
                world.writes.push(`${api.name} ${key}=${value}`);
                world.general.set(api.name, { ...world.general.get(api.name), [key]: value });
            }
        },
        describe: ({ key, value }: { key: string; value: number }) => `${key} set to ${value}`,
    };
    const areas: Record<string, unknown> = {
        rewrites: list("rewrites", world.rewrites, null),
        general,
        clients: list("clients", world.clients, "v0.108.0"),
    };
    const order = ["rewrites", "general", "clients"];
    return {
        configAreaSync: (area: string) => areas[area],
        inRunOrder: (chosen: string[]) => order.filter((area) => chosen.includes(area)),
    };
});

import db from "../core/Database.js";
import { ProviderInputSchema, type Provider } from "@dpm/shared";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ClusterSyncService } from "./ClusterSyncService.js";
import { ProviderService } from "./ProviderService.js";
import { clusterNodeAccess } from "./providerAccess.js";

type ClusterProvider = Extract<Provider, { type: "adguard-cluster" }>;
type NodeInput = { id?: string; name: string; primary?: boolean; secret?: string };

const USER = "admin";

beforeEach(() => {
    for (const store of [world.rewrites, world.general, world.clients, world.versions]) store.clear();
    world.down.clear();
    world.refusing.clear();
    world.writes.length = 0;
    db.exec("DELETE FROM providers; DELETE FROM activity;");
});

/** Gives a node what it holds before the cluster is made. */
function instance(name: string, general: Record<string, number> = { cache: 1, ttl: 10 }, rewrites: string[] = ["nas.lan"]) {
    world.general.set(name, { ...general });
    world.rewrites.set(name, [...rewrites]);
}

const clusterInput = (nodes: NodeInput[], areas: string[] = ["general"]) =>
    ProviderInputSchema.parse({
        type: "adguard-cluster",
        name: "adguard-internal",
        areas,
        nodes: nodes.map((n) => ({ url: `http://${n.name.toLowerCase()}.lan:3000`, username: "admin", secret: n.id ? undefined : "pw", ...n })),
    });

const create = (nodes: NodeInput[], areas?: string[]) => ProviderService.create(clusterInput(nodes, areas), USER) as ClusterProvider;

/** Saves the cluster as given, its stored nodes named by their ids. */
const save = (cluster: ClusterProvider, nodes: NodeInput[], areas?: string[]) => {
    const ids = new Map(cluster.nodes.map((n) => [n.name, n.id]));
    return ProviderService.update(cluster.id, clusterInput(nodes.map((n) => ({ id: ids.get(n.name), ...n })), areas), USER) as ClusterProvider;
};

const events = (kind?: string) =>
    (db.prepare("SELECT kind, level, data FROM activity ORDER BY occurred_at, rowid").all() as { kind: string; level: string; data: string }[])
        .filter((e) => (kind ? e.kind === kind : e.kind.startsWith("cluster.")))
        .map((e) => ({ kind: e.kind, level: e.level, data: JSON.parse(e.data) as Record<string, unknown> }));

const linkOf = (cluster: ClusterProvider, name: string, area = "general") => {
    const nodeId = cluster.nodes.find((n) => n.name === name)?.id;
    return ClusterSyncService.status(cluster.id)!.links.find((l) => l.nodeId === nodeId && l.area === area);
};

/** A cluster of three nodes, A its primary, kept alike in its rewrites and `general`: B differed, C did not. */
async function made() {
    instance("A", { cache: 1, ttl: 10 });
    instance("B", { cache: 2, ttl: 10 });
    instance("C", { cache: 1, ttl: 10 });
    const cluster = create([{ name: "A", primary: true }, { name: "B" }, { name: "C" }]);
    await ClusterSyncService.runCluster(cluster.id);
    return cluster;
}

/** `made`, with what its first run recorded cleared: a test reads what happens after. */
async function threeNodes() {
    const cluster = await made();
    db.exec("DELETE FROM activity");
    world.writes.length = 0;
    return cluster;
}

describe("a new cluster", () => {
    it("keeps the rewrites alike whatever areas are chosen", () => {
        instance("A");
        expect(create([{ name: "A", primary: true }], []).areas).toEqual(["rewrites"]);
    });

    it("writes nothing on saving: the next run does", async () => {
        instance("A", { cache: 1, ttl: 10 });
        instance("B", { cache: 2, ttl: 10 });
        const cluster = create([{ name: "A", primary: true }, { name: "B" }]);
        await Promise.resolve();
        expect(world.writes).toEqual([]);
        expect(ClusterSyncService.status(cluster.id)!.lastRunAt).toBeNull();
        await ClusterSyncService.runCluster(cluster.id);
        expect(world.writes).toEqual(["B cache=1"]);
    });

    it("brings every node to the primary's state on its first run, and names what it wrote", async () => {
        const cluster = await made();
        expect(world.general.get("B")).toEqual({ cache: 1, ttl: 10 });
        expect(linkOf(cluster, "B")?.status).toBe("in_sync");
        expect(linkOf(cluster, "C", "rewrites")?.status).toBe("in_sync");
        expect(linkOf(cluster, "A")).toBeUndefined();
        expect(events()).toEqual([
            {
                kind: "cluster.propagated",
                level: "info",
                data: { cluster: "adguard-internal", primary: "A", areas: ["General settings"], nodes: ["B"], steps: ["cache set to 1"] },
            },
        ]);
    });

    it("shows in a preview what saving would write, and changes nothing", async () => {
        instance("A", { cache: 1, ttl: 10 });
        instance("B", { cache: 2, ttl: 20 }, []);
        const preview = await ClusterSyncService.preview(clusterInput([{ name: "A", primary: true }, { name: "B" }]) as never);
        expect(preview).toEqual({
            error: null,
            nodes: [
                {
                    name: "B",
                    areas: [
                        { area: "rewrites", steps: ["rewrites set to nas.lan"], error: null },
                        { area: "general", steps: ["cache set to 1", "ttl set to 10"], error: null },
                    ],
                },
            ],
        });
        expect(world.writes).toEqual([]);
    });

    it("refuses a node at the address of another provider", async () => {
        await made();
        expect(() =>
            ProviderService.create(ProviderInputSchema.parse({ type: "adguard", name: "single", url: "http://b.lan:3000/", username: "admin", secret: "pw" }), USER),
        ).toThrow('http://b.lan:3000/ is the address of the node B of the cluster "adguard-internal" already');
    });
});

describe("a run", () => {
    it("spreads a change made at the primary and names it", async () => {
        const cluster = await threeNodes();
        world.general.set("A", { cache: 5, ttl: 10 });
        await ClusterSyncService.runCluster(cluster.id);
        expect(world.writes).toEqual(["B cache=5", "C cache=5"]);
        expect(events()).toMatchObject([{ kind: "cluster.propagated", data: { primary: "A", areas: ["General settings"], nodes: ["B", "C"], steps: ["cache set to 5"] } }]);
    });

    it("writes over a change made at a node, and reports what it wrote", async () => {
        const cluster = await threeNodes();
        world.rewrites.set("B", ["nas.lan", "printer.lan"]);
        await ClusterSyncService.runCluster(cluster.id);
        expect(world.rewrites.get("B")).toEqual(["nas.lan"]);
        expect(events()).toMatchObject([
            { kind: "cluster.corrected", level: "warning", data: { node: "B", primary: "A", areas: ["DNS rewrites"], steps: ["rewrites set to nas.lan"] } },
        ]);
    });

    it("leaves a node that is down for later, and brings it up as one that was behind", async () => {
        const cluster = await threeNodes();
        world.down.add("C");
        world.general.set("A", { cache: 7, ttl: 10 });
        await ClusterSyncService.runCluster(cluster.id);
        expect(linkOf(cluster, "C")).toMatchObject({ status: "pending", error: "C could not be reached" });
        world.down.delete("C");
        await ClusterSyncService.runCluster(cluster.id);
        expect(world.general.get("C")).toEqual({ cache: 7, ttl: 10 });
        expect(events("cluster.corrected")).toEqual([]);
        expect(events("cluster.propagated").map((e) => e.data.nodes)).toEqual([["B"], ["C"]]);
    });

    it("remembers at each node whether it answered", async () => {
        const cluster = await threeNodes();
        world.down.add("C");
        world.versions.set("B", "v0.107.33");
        await ClusterSyncService.runCluster(cluster.id);
        const stored = ProviderRepository.findById(cluster.id) as ClusterProvider;
        expect(stored.nodes.map((n) => [n.name, n.version, n.lastError])).toEqual([
            ["A", "v0.107.79", null],
            ["B", "v0.107.33", null],
            ["C", "v0.107.79", "C could not be reached"],
        ]);
    });

    it("records nothing for a run that finds every node in step", async () => {
        const cluster = await threeNodes();
        await ClusterSyncService.runCluster(cluster.id);
        expect(events()).toEqual([]);
        expect(world.writes).toEqual([]);
    });

    it("pauses while the primary cannot be read, says so once, and resumes", async () => {
        const cluster = await threeNodes();
        world.down.add("A");
        world.general.set("B", { cache: 3, ttl: 10 });
        await ClusterSyncService.runCluster(cluster.id);
        await ClusterSyncService.runCluster(cluster.id);
        expect(world.general.get("B")).toEqual({ cache: 3, ttl: 10 });
        expect(ClusterSyncService.status(cluster.id)!.pausedError).toBe("A could not be reached");
        expect(linkOf(cluster, "B")).toMatchObject({ status: "paused", error: "A cannot be read: A could not be reached" });
        expect(events().map((e) => e.kind)).toEqual(["cluster.paused"]);

        world.down.delete("A");
        await ClusterSyncService.runCluster(cluster.id);
        expect(ClusterSyncService.status(cluster.id)!.pausedError).toBeNull();
        expect(events().map((e) => e.kind)).toEqual(["cluster.paused", "cluster.resumed", "cluster.corrected"]);
    });

    it("reports a failed write once, and again only for another reason", async () => {
        const cluster = await threeNodes();
        world.refusing.add("B");
        world.general.set("A", { cache: 4, ttl: 10 });
        await ClusterSyncService.runCluster(cluster.id);
        await ClusterSyncService.runCluster(cluster.id);
        expect(linkOf(cluster, "B")).toMatchObject({ status: "error", error: "B refused it", attempts: 2 });
        expect(events("cluster.write_failed")).toMatchObject([{ level: "error", data: { node: "B", area: "General settings", error: "B refused it" } }]);

        world.refusing.delete("B");
        await ClusterSyncService.runCluster(cluster.id);
        expect(linkOf(cluster, "B")).toMatchObject({ status: "in_sync", error: null, attempts: 0 });
        expect(events("cluster.corrected")).toEqual([]);
    });

    it("says once that a node is too old for an area, and keeps the others going", async () => {
        const cluster = await threeNodes();
        world.clients.set("A", ["TV"]);
        world.versions.set("A", "v0.108.1");
        world.versions.set("B", "v0.107.33");
        world.versions.set("C", "v0.108.1");
        const saved = save(cluster, [{ name: "A", primary: true }, { name: "B" }, { name: "C" }], ["general", "clients"]);
        await ClusterSyncService.runCluster(saved.id);
        await ClusterSyncService.runCluster(saved.id);
        expect(linkOf(saved, "B", "clients")).toMatchObject({ status: "error", error: "Client settings need AdGuard Home v0.108.0 or later; B runs v0.107.33" });
        expect(events("cluster.write_failed")).toMatchObject([{ data: { node: "B", area: "Client settings" } }]);
        expect(linkOf(saved, "C", "clients")?.status).toBe("in_sync");
        expect(linkOf(saved, "B", "general")?.status).toBe("in_sync");
    });

    it("counts clusters, writes and failures as one run of the scheduler", async () => {
        await threeNodes();
        world.refusing.add("B");
        world.general.set("A", { cache: 2, ttl: 10 });
        expect(await ClusterSyncService.run("manual")).toEqual({ clusters: 1, written: 1, failed: 1 });
    });
});

describe("changing a cluster", () => {
    it("writes the new primary's state over the old one as a node, not as a change made there", async () => {
        const cluster = await threeNodes();
        world.general.set("B", { cache: 8, ttl: 10 });
        const saved = save(cluster, [{ name: "A" }, { name: "B", primary: true }, { name: "C" }]);
        await ClusterSyncService.runCluster(saved.id);
        expect(world.general.get("A")).toEqual({ cache: 8, ttl: 10 });
        expect(events().map((e) => e.kind)).toEqual(["cluster.primary_changed", "cluster.propagated"]);
        expect(events("cluster.primary_changed")[0].data).toMatchObject({ cluster: "adguard-internal", from: "A", to: "B", user: USER });
        expect(linkOf(saved, "B")).toBeUndefined();
    });

    it("forgets a node that left the cluster, without touching it", async () => {
        const cluster = await threeNodes();
        const saved = save(cluster, [{ name: "A", primary: true }, { name: "B" }]);
        world.general.set("A", { cache: 6, ttl: 10 });
        await ClusterSyncService.runCluster(saved.id);
        expect(saved.nodes.map((n) => n.name)).toEqual(["A", "B"]);
        expect(world.general.get("C")).toEqual({ cache: 1, ttl: 10 });
        // What is left are the links of B; the primary has none.
        expect(db.prepare("SELECT COUNT(*) AS n FROM cluster_links").get()).toEqual({ n: 2 });
    });

    it("asks in a preview only about what starts over: a new node, an area switched on", async () => {
        const cluster = await threeNodes();
        world.clients.set("A", ["TV"]);
        instance("D", { cache: 9, ttl: 10 });
        const ids = new Map(cluster.nodes.map((n) => [n.name, n.id]));
        const input = clusterInput(
            [{ name: "A", primary: true }, { name: "B" }, { name: "C" }, { name: "D" }].map((n) => ({ id: ids.get(n.name), ...n })),
            ["general", "clients"],
        );
        const preview = await ClusterSyncService.preview(input as never, cluster.id);
        expect(preview.nodes.map((n) => [n.name, n.areas.map((a) => a.area)])).toEqual([
            ["B", ["clients"]],
            ["C", ["clients"]],
            ["D", ["rewrites", "general", "clients"]],
        ]);
    });

    it("drops what an area switched off remembered", async () => {
        const cluster = await threeNodes();
        save(cluster, [{ name: "A", primary: true }, { name: "B" }, { name: "C" }], []);
        expect(linkOf(cluster, "B", "general")).toBeUndefined();
        expect(linkOf(cluster, "B", "rewrites")?.status).toBe("in_sync");
    });

    it("lets the writes of records follow only the nodes whose rewrites are in step", async () => {
        const cluster = await threeNodes();
        world.down.add("C");
        world.rewrites.set("A", ["nas.lan", "tv.lan"]);
        await ClusterSyncService.runCluster(cluster.id);
        expect(clusterNodeAccess(cluster)!.map((n) => [n.name, n.primary, n.followsWrites])).toEqual([
            ["A", true, false],
            ["B", false, true],
            ["C", false, false],
        ]);
    });
});
