import { describe, expect, it } from "vitest";
import type { ClusterNode, ClusterPreview, ClusterStatus } from "@dpm/shared";
import {
    MAX_CHECK_LINES,
    checkFindings,
    checkOutcome,
    clusterBadge,
    describeClusterSave,
    emptyNodeDraft,
    makePrimary,
    nodeDraftsFrom,
    nodeErrors,
    nodeInputFrom,
    nodeRows,
    putNode,
    removeNode,
    type NodeDraft,
} from "./clusterForm";

const stored = (id: string, extra: Partial<ClusterNode> = {}): ClusterNode => ({
    id,
    name: `adguard-${id}`,
    url: `http://10.0.0.${id}:3000`,
    username: "admin",
    allowSelfSigned: false,
    primary: id === "1",
    hasSecret: true,
    version: "v0.107.79",
    lastSeenAt: null,
    lastError: null,
    ...extra,
});

const twoNodes = () => nodeDraftsFrom([stored("1"), stored("2")]);

describe("the nodes of a cluster", () => {
    it("start a new node after the last one: its name free, its user the same, primary only as the first", () => {
        const first = emptyNodeDraft([]);
        expect(first).toMatchObject({ id: null, name: "adguard-1", username: "", primary: true });
        const next = emptyNodeDraft(twoNodes());
        expect(next).toMatchObject({ name: "adguard-3", username: "admin", primary: false });
        expect(next.key).not.toBe(first.key);
    });

    it("send a stored node by its id, and its password only when one was typed", () => {
        const [node] = twoNodes();
        expect(nodeInputFrom(node)).toEqual({ id: "1", name: "adguard-1", url: "http://10.0.0.1:3000", username: "admin", secret: undefined, allowSelfSigned: false, primary: true });
        expect(nodeInputFrom({ ...emptyNodeDraft([]), url: "http://a:3000", username: "u", secret: "pw" })).toMatchObject({ id: undefined, secret: "pw" });
    });

    it("refuse a node whose name or address another node has, and a new node without a password", () => {
        const nodes = twoNodes();
        const added: NodeDraft = { ...emptyNodeDraft(nodes), name: "ADGUARD-1", url: "http://10.0.0.2:3000/", username: "admin" };
        expect(nodeErrors(added, nodes)).toEqual({
            name: 'Another node is called "ADGUARD-1" already',
            url: "Another node has this address already",
            secret: "Enter the password",
        });
        expect(nodeErrors({ ...added, url: "ftp://x" }, nodes).url).toBe("Must be an http:// or https:// URL");
        // A stored node keeps its password while the field stays empty.
        expect(nodeErrors(nodes[0], nodes)).toEqual({});
    });

    it("put a node in its place or at the end, a primary taking the place of the one before", () => {
        const nodes = twoNodes();
        const renamed = putNode(nodes, { ...nodes[1], name: "b" });
        expect(renamed.map((n) => n.name)).toEqual(["adguard-1", "b"]);
        const added = putNode(nodes, { ...emptyNodeDraft(nodes), primary: true });
        expect(added.map((n) => n.primary)).toEqual([false, false, true]);
        expect(makePrimary(nodes, "2").map((n) => n.primary)).toEqual([false, true]);
    });

    it("give the primary's place to the first of the rest when it is removed", () => {
        const nodes = nodeDraftsFrom([stored("1"), stored("2"), stored("3")]);
        expect(removeNode(nodes, "1").map((n) => [n.key, n.primary])).toEqual([
            ["2", true],
            ["3", false],
        ]);
        expect(removeNode(nodes, "3").map((n) => n.primary)).toEqual([true, false]);
    });
});

describe("describeClusterSave", () => {
    it("names what the next run writes to each node, the first few changes of each", () => {
        const question = describeClusterSave(
            "adguard-internal",
            {
                error: null,
                nodes: [
                    { name: "adguard-2", areas: [{ area: "rewrites", steps: ["a", "b", "c", "d"], error: null }, { area: "general", steps: [], error: null }] },
                    { name: "adguard-3", areas: [{ area: "clients", steps: [], error: "Client settings need AdGuard Home v0.108.0 or later" }] },
                ],
            },
            null,
        );
        expect(question).toEqual({
            title: "Save adguard-internal?",
            lines: [
                "adguard-2: 4 changes in DNS rewrites (a; b; c and 1 more).",
                "adguard-3: Client settings cannot be read (Client settings need AdGuard Home v0.108.0 or later).",
            ],
            danger: true,
        });
    });

    it("asks nothing where nothing is written, and says so where the nodes could not be read", () => {
        expect(describeClusterSave("c", { error: null, nodes: [{ name: "n", areas: [{ area: "rewrites", steps: [], error: null }] }] }, null)).toBeNull();
        expect(describeClusterSave("c", { error: "adguard-1 cannot be read: down" }, null)?.lines[0]).toMatch(/^What the nodes hold could not be read: adguard-1 cannot be read: down\./);
        expect(describeClusterSave("c", { error: null, nodes: [] }, { from: "a", to: "b" })?.lines[0]).toMatch(/^b becomes the primary/);
    });
});

describe("the status of a cluster", () => {
    const status = (links: ClusterStatus["links"], pausedError: string | null = null): ClusterStatus => ({
        providerId: "c",
        primaryNodeId: "1",
        areas: ["rewrites", "general"],
        pausedError,
        lastRunAt: null,
        links,
    });
    const link = (nodeId: string, area: "rewrites" | "general", state: "in_sync" | "pending" | "error") => ({
        nodeId,
        area,
        status: state,
        error: state === "error" ? "refused" : null,
        attempts: 0,
        lastAttemptAt: null,
        syncedAt: null,
    });

    it("lists every node but the primary with every area, a link not run yet as none", () => {
        const rows = nodeRows(status([link("2", "rewrites", "in_sync")]), [stored("1"), stored("2")]);
        expect(rows.map((r) => [r.node.id, r.links.map((l) => l.link?.status ?? null)])).toEqual([["2", ["in_sync", null]]]);
    });

    it("says in the list how the nodes stand, the worst first", () => {
        expect(clusterBadge(undefined)).toBeNull();
        expect(clusterBadge(status([]))).toBeNull();
        expect(clusterBadge(status([link("2", "rewrites", "in_sync")]))?.label).toBe("Nodes in step");
        expect(clusterBadge(status([link("2", "rewrites", "in_sync"), link("2", "general", "pending")]))?.label).toBe("Nodes waiting");
        expect(clusterBadge(status([link("2", "general", "error"), link("2", "rewrites", "pending")]))?.label).toBe("Nodes failed");
        expect(clusterBadge(status([link("2", "general", "error")], "down"))?.label).toBe("Paused");
    });
});

describe("a check of a cluster", () => {
    const result = (areas: ClusterPreview["nodes"][number]["areas"]): ClusterPreview => ({ error: null, nodes: [{ name: "adguard-2", areas }] });

    it("says every node is in step when nothing differs", () => {
        const same = result([{ area: "rewrites", steps: [], error: null }]);
        expect(checkOutcome("c", same)).toEqual({ variant: "success", title: "c: every node in step" });
        expect(checkFindings(same)).toEqual([]);
    });

    it("lists only what differs or cannot be read, and counts the areas", () => {
        const found = result([
            { area: "rewrites", steps: ["Rewrite a added"], error: null },
            { area: "general", steps: [], error: null },
            { area: "clients", steps: [], error: "too old" },
        ]);
        expect(checkFindings(found).map((f) => [f.key, f.lines, f.error])).toEqual([
            ["adguard-2:rewrites", ["Rewrite a added"], null],
            ["adguard-2:clients", [], "too old"],
        ]);
        expect(checkOutcome("c", found)).toMatchObject({ variant: "error", description: "1 area differs, 1 area cannot be read" });
        expect(checkOutcome("c", result([{ area: "rewrites", steps: ["x"], error: null }]))).toMatchObject({ variant: "warning", title: "c: nodes differ" });
    });

    it("counts the changes beyond the first ones", () => {
        const steps = Array.from({ length: MAX_CHECK_LINES + 3 }, (_, i) => `step ${i}`);
        const lines = checkFindings(result([{ area: "rewrites", steps, error: null }]))[0].lines;
        expect(lines).toHaveLength(MAX_CHECK_LINES + 1);
        expect(lines[lines.length - 1]).toBe("and 3 more");
    });

    it("says why the primary could not be read", () => {
        expect(checkOutcome("c", { error: "adguard-1 cannot be read: down", nodes: [] })).toEqual({
            variant: "error",
            title: "c could not be checked",
            description: "adguard-1 cannot be read: down",
        });
    });
});
