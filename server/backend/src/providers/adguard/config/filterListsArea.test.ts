import { describe, expect, it } from "vitest";
import { answeringApi, recorded } from "../../../testing/adguardRecording.js";
import { allowlistsArea, blocklistsArea } from "./filterListsArea.js";

const REGISTRY = "https://adguardteam.github.io/HostlistsRegistry/assets";

describe("blocklistsArea and allowlistsArea", () => {
    it("read each kind by URL, without ids, counts and download times", async () => {
        for (const version of ["v0.107.79", "v0.107.33"] as const) {
            const raw = await blocklistsArea.read(answeringApi(recorded(version)).api);
            expect(blocklistsArea.normalise(raw)).toEqual({
                lists: [
                    { url: `${REGISTRY}/filter_1.txt`, name: "AdGuard DNS filter", enabled: true },
                    { url: `${REGISTRY}/filter_2.txt`, name: "AdAway Default Blocklist", enabled: false },
                    { url: `${REGISTRY}/filter_9.txt`, name: "Renamed", enabled: false },
                ],
            });
            expect(allowlistsArea.normalise(raw)).toEqual({ lists: [{ url: `${REGISTRY}/filter_11.txt`, name: "Allowed hosts", enabled: true }] });
        }
    });

    it("reads no lists, sent as null, as none", () => {
        expect(allowlistsArea.normalise({ filters: null, whitelist_filters: null })).toEqual({ lists: [] });
    });

    it("removes, adds and changes lists, and switches an added one off where the primary has it off", async () => {
        const a = { url: "https://a.example/list.txt", name: "A", enabled: true };
        const b = { url: "https://b.example/list.txt", name: "B", enabled: false };
        const c = { url: "https://c.example/list.txt", name: "C", enabled: true };
        const steps = blocklistsArea.diff({ lists: [{ ...a, name: "A2" }, b] }, { lists: [a, c] });
        expect(steps.map((s) => blocklistsArea.describe(s))).toEqual(['Blocklist "C" removed', 'Blocklist "A2" changed', 'Blocklist "B" added, switched off']);

        const { api, writes } = answeringApi({});
        await blocklistsArea.apply(api, steps);
        expect(writes.map((w) => `${w.path} ${JSON.stringify(w.body)}`)).toEqual([
            `/control/filtering/remove_url {"url":"${c.url}","whitelist":false}`,
            `/control/filtering/set_url {"url":"${a.url}","whitelist":false,"data":{"name":"A2","url":"${a.url}","enabled":true}}`,
            `/control/filtering/add_url {"name":"B","url":"${b.url}","whitelist":false}`,
            `/control/filtering/set_url {"url":"${b.url}","whitelist":false,"data":{"name":"B","url":"${b.url}","enabled":false}}`,
        ]);
        // AdGuard Home downloads a list before it answers the addition.
        expect(writes[2].timeoutMs).toBe(120_000);
        expect(writes[0].timeoutMs).toBe(10_000);
    });

    it("writes allowlists as such", async () => {
        const { api, writes } = answeringApi({});
        await allowlistsArea.apply(api, [{ kind: "remove", list: { url: "https://a.example", name: "", enabled: true } }]);
        expect(writes[0].body).toEqual({ url: "https://a.example", whitelist: true });
        expect(allowlistsArea.describe({ kind: "remove", list: { url: "https://a.example", name: "", enabled: true } })).toBe('Allowlist "https://a.example" removed');
    });

    it("passes on why AdGuard Home refused a list", async () => {
        const { api } = answeringApi({}, { "/control/filtering/add_url": 'Filter with URL "https://a.example": url already exists' });
        await expect(allowlistsArea.apply(api, [{ kind: "add", list: { url: "https://a.example", name: "A", enabled: true } }])).rejects.toThrow(
            'AdGuard Home refused it (HTTP 400): Filter with URL "https://a.example": url already exists',
        );
    });
});
