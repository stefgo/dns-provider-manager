import { describe, expect, it } from "vitest";
import { answeringApi, recorded } from "../../../testing/adguardRecording.js";
import { commonShape, project } from "../../configState.js";
import { clientsArea, type ClientsState } from "./clientsArea.js";
import type { JsonObject } from "./shapes.js";

const stateOf = async (answers: Record<string, unknown>) => clientsArea.normalise(await clientsArea.read(answeringApi(answers).api));

const client = (name: string, ids: string[], over: JsonObject = {}): JsonObject => ({ name, ids, tags: [], blocked_services: [], upstreams: [], ...over });

describe("clientsArea", () => {
    it("reads the clients set up by hand, by name, with every setting in one order", async () => {
        const { clients } = await stateOf(recorded("v0.107.79"));
        expect(clients.map((c) => c.name)).toEqual(["Bare", "TV"]);
        const tv = clients[1];
        expect(tv).toMatchObject({
            ids: ["192.168.1.50", "aa:bb:cc:dd:ee:ff"],
            tags: ["device_tv"],
            blocked_services: ["tiktok", "youtube"],
            upstreams: ["1.1.1.1"],
            upstreams_cache_size: 1024,
            safe_search: { enabled: true, ecosia: true, youtube: false },
        });
        expect(tv).not.toHaveProperty("safesearch_enabled");
        expect(tv.blocked_services_schedule).toEqual({
            time_zone: "Europe/Berlin",
            sun: null,
            mon: { start: 3600000, end: 7200000 },
            tue: null,
            wed: null,
            thu: null,
            fri: null,
            sat: null,
        });
        // `null` lists read as empty.
        expect(clients[0]).toMatchObject({ tags: [], blocked_services: [], upstreams: [] });
    });

    it("reads no clients at all as none", async () => {
        expect(await stateOf({ "/control/clients": { clients: null, auto_clients: [] } })).toEqual({ clients: [] });
    });

    it("compares the clients of an older instance on the fields both know", async () => {
        const newer = await stateOf(recorded("v0.107.79"));
        const older = await stateOf(recorded("v0.107.33"));
        const shape = commonShape([newer, older]);
        expect(project(newer, shape)).toEqual(project(older, shape));
        expect(project(newer, shape).clients[1]).not.toHaveProperty("upstreams_cache_size");
    });

    it("removes first, then changes what frees an id, then what takes one, then adds", () => {
        const current: ClientsState = {
            clients: [client("Gone", ["10.0.0.1"]), client("Laptop", ["10.0.0.2", "10.0.0.3"]), client("Phone", ["10.0.0.4"])],
        };
        // 10.0.0.3 moves from the laptop to the phone.
        const target: ClientsState = {
            clients: [client("Laptop", ["10.0.0.2"]), client("New", ["10.0.0.9"]), client("Phone", ["10.0.0.3", "10.0.0.4"])],
        };
        const steps = clientsArea.diff(target, current);
        expect(steps.map((s) => clientsArea.describe(s))).toEqual([
            'Client "Gone" removed',
            'Client "Laptop" changed',
            'Client "Phone" changed',
            'Client "New" added',
        ]);
        expect(clientsArea.diff(target, target)).toEqual([]);
    });

    it("writes a change over the copy's client, and a schedule as AdGuard Home takes it", async () => {
        const answers = recorded("v0.107.79");
        const { clients } = await stateOf(answers);
        const tv = { ...clients[1], upstreams: ["9.9.9.9"] };
        const { api, writes } = answeringApi(answers);
        await clientsArea.apply(api, [
            { kind: "delete", name: "Bare" },
            { kind: "update", name: "TV", client: tv },
            { kind: "add", client: client("New", ["10.0.0.9"]) },
        ]);
        expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(["POST /control/clients/delete", "POST /control/clients/update", "POST /control/clients/add"]);
        expect(writes[0].body).toEqual({ name: "Bare" });
        const update = writes[1].body as { name: string; data: JsonObject };
        expect(update.name).toBe("TV");
        expect(update.data).toMatchObject({ upstreams: ["9.9.9.9"], upstreams_cache_size: 1024 });
        expect(update.data).not.toHaveProperty("safesearch_enabled");
        expect(update.data.blocked_services_schedule).toEqual({ time_zone: "Europe/Berlin", mon: { start: 3600000, end: 7200000 } });
    });

    it("keeps a field the primary does not know at its value on the copy", async () => {
        const answers = recorded("v0.107.79");
        const { api, writes } = answeringApi(answers);
        // From a v0.107.33 primary: no upstream cache, no Ecosia.
        const older = (await stateOf(recorded("v0.107.33"))).clients.find((c) => c.name === "TV")!;
        await clientsArea.apply(api, [{ kind: "update", name: "TV", client: { ...older, ignore_querylog: false } }]);
        const data = (writes[0].body as { data: JsonObject }).data;
        expect(data).toMatchObject({ ignore_querylog: false, upstreams_cache_enabled: true, upstreams_cache_size: 1024, safe_search: { ecosia: true } });
    });
});
