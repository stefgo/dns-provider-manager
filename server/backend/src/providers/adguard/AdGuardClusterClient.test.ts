import { describe, expect, it } from "vitest";
import type { HttpOptions } from "../http.js";
import { AdGuardClusterClient, type ClusterNodeAccess } from "./AdGuardClusterClient.js";
import { rewriteId, type AdGuardRewrite } from "./adguardMapping.js";

/**
 * Three AdGuard Home instances behind one fake network, each holding its rewrites as AdGuard
 * Home does: a pair added twice is there twice, a deletion removes every repeat.
 */
function network(down: readonly string[] = []) {
    const held = new Map<string, AdGuardRewrite[]>([
        ["10.0.0.1", []],
        ["10.0.0.2", []],
        ["10.0.0.3", []],
    ]);
    const calls: string[] = [];
    const request = async (url: string, options: HttpOptions) => {
        const { hostname, pathname } = new URL(url);
        const method = options.method ?? "GET";
        calls.push(`${hostname} ${method} ${pathname}`);
        if (down.includes(hostname)) throw new Error(`${hostname} does not answer`);
        const list = held.get(hostname)!;
        const body = options.body as { domain: string; answer: string; enabled?: boolean } & { target: AdGuardRewrite; update: AdGuardRewrite };
        const same = (a: AdGuardRewrite, b: AdGuardRewrite) => a.domain === b.domain && a.answer === b.answer;
        switch (`${method} ${pathname}`) {
            case "GET /control/status":
                return { status: 200, body: JSON.stringify({ version: "v0.107.79" }) };
            case "GET /control/rewrite/settings":
                return { status: 200, body: JSON.stringify({ enabled: true }) };
            case "GET /control/rewrite/list":
                return { status: 200, body: JSON.stringify(list) };
            case "POST /control/rewrite/add":
                list.push({ domain: body.domain, answer: body.answer, enabled: body.enabled ?? true });
                return { status: 200, body: "OK" };
            case "POST /control/rewrite/delete":
                held.set(hostname, list.filter((r) => !same(r, body)));
                return { status: 200, body: "OK" };
            case "PUT /control/rewrite/update":
                held.set(hostname, list.map((r) => (same(r, body.target) ? { ...body.update } : r)));
                return { status: 200, body: "OK" };
        }
        return { status: 404, body: "404 page not found" };
    };
    return { held, calls, request };
}

const node = (id: string, host: string, extra: Partial<ClusterNodeAccess> = {}): ClusterNodeAccess => ({
    id,
    name: `adguard-${id}`,
    url: `http://${host}:3000`,
    username: "admin",
    password: "pw",
    allowSelfSigned: false,
    primary: false,
    followsWrites: true,
    ...extra,
});

const record = { name: "nas.lan", type: "A" as const, value: "10.0.0.20", ttl: null, proxied: false };

describe("AdGuardClusterClient", () => {
    it("reads what the primary holds", async () => {
        const net = network();
        net.held.set("10.0.0.2", [{ domain: "nas.lan", answer: "10.0.0.20", enabled: true }]);
        const client = new AdGuardClusterClient({ nodes: [node("1", "10.0.0.1"), node("2", "10.0.0.2", { primary: true })] }, net.request);
        expect((await client.listRecords()).map((e) => e.name)).toEqual(["nas.lan"]);
        expect(net.calls.every((c) => c.startsWith("10.0.0.2"))).toBe(true);
    });

    it("writes a record to the primary, then to every node that follows the writes", async () => {
        const net = network();
        // Node 3 holds it already: it is not added a second time.
        net.held.set("10.0.0.3", [{ domain: "nas.lan", answer: "10.0.0.20", enabled: true }]);
        const client = new AdGuardClusterClient(
            { nodes: [node("1", "10.0.0.1", { primary: true }), node("2", "10.0.0.2"), node("3", "10.0.0.3")] },
            net.request,
        );
        await client.create(null, record);
        for (const host of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
            expect(net.held.get(host)).toEqual([{ domain: "nas.lan", answer: "10.0.0.20", enabled: true }]);
        }
    });

    it("leaves a node that does not follow the writes to the next run", async () => {
        const net = network();
        const client = new AdGuardClusterClient(
            { nodes: [node("1", "10.0.0.1", { primary: true }), node("2", "10.0.0.2", { followsWrites: false })] },
            net.request,
        );
        await client.create(null, record);
        expect(net.held.get("10.0.0.2")).toEqual([]);
    });

    it("says which node a write did not reach, and does not fail the record", async () => {
        const net = network(["10.0.0.2"]);
        const behind: string[] = [];
        const client = new AdGuardClusterClient(
            { nodes: [node("1", "10.0.0.1", { primary: true }), node("2", "10.0.0.2"), node("3", "10.0.0.3")], onNodeBehind: (id) => behind.push(id) },
            net.request,
        );
        await expect(client.create(null, record)).resolves.toMatchObject({ name: "nas.lan" });
        expect(behind).toEqual(["2"]);
        expect(net.held.get("10.0.0.3")).toHaveLength(1);
    });

    it("fails a write the primary refuses, before any other node is touched", async () => {
        const net = network(["10.0.0.1"]);
        const client = new AdGuardClusterClient({ nodes: [node("1", "10.0.0.1", { primary: true }), node("2", "10.0.0.2")] }, net.request);
        await expect(client.create(null, record)).rejects.toThrow("does not answer");
        expect(net.calls.some((c) => c.startsWith("10.0.0.2"))).toBe(false);
    });

    it("changes and removes a record at every node, adding it where the old one was missing", async () => {
        const net = network();
        const old = { domain: "nas.lan", answer: "10.0.0.20", enabled: true };
        net.held.set("10.0.0.1", [{ ...old }]);
        net.held.set("10.0.0.2", [{ ...old }]);
        const client = new AdGuardClusterClient(
            { nodes: [node("1", "10.0.0.1", { primary: true }), node("2", "10.0.0.2"), node("3", "10.0.0.3")] },
            net.request,
        );
        const target = { externalId: rewriteId(old), zoneId: null, zone: null };
        const entry = await client.update(target, { ...record, value: "10.0.0.21" });
        for (const host of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
            expect(net.held.get(host)).toEqual([{ domain: "nas.lan", answer: "10.0.0.21", enabled: true }]);
        }
        await client.delete(entry);
        for (const host of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) expect(net.held.get(host)).toEqual([]);
    });

    it("tests every node, and fails only when the primary does not answer", async () => {
        const net = network(["10.0.0.2"]);
        const client = new AdGuardClusterClient({ nodes: [node("1", "10.0.0.1", { primary: true }), node("2", "10.0.0.2")] }, net.request);
        const said = await client.test();
        expect(said).toContain("adguard-1 (primary): AdGuard Home v0.107.79 answered");
        expect(said).toContain("adguard-2 failed: 10.0.0.2 does not answer");

        const primaryDown = new AdGuardClusterClient({ nodes: [node("1", "10.0.0.1"), node("2", "10.0.0.2", { primary: true })] }, net.request);
        await expect(primaryDown.test()).rejects.toThrow("adguard-2 (primary) failed");
    });
});
