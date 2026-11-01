import { describe, expect, it } from "vitest";
import { answeringApi, recorded } from "../../../testing/adguardRecording.js";
import { commonShape, project } from "../../configState.js";
import { generalArea } from "./generalArea.js";

const stateOf = async (version: "v0.107.79" | "v0.107.33") => generalArea.normalise(await generalArea.read(answeringApi(recorded(version)).api));

describe("generalArea", () => {
    it("reads every part of the general settings", async () => {
        expect(await stateOf("v0.107.79")).toEqual({
            filtering: { enabled: true, interval: 12 },
            safebrowsing: true,
            parental: true,
            safesearch: { enabled: true, bing: false, duckduckgo: true, ecosia: true, google: true, pixabay: true, yandex: true, youtube: true },
            querylog: { ignored: ["example.org"], interval: 86400000, enabled: true, ignored_enabled: true, anonymize_client_ip: true },
            stats: { ignored: ["b.example"], interval: 604800000, enabled: true, ignored_enabled: true },
        });
    });

    it("compares an older instance without the fields it does not know", async () => {
        const newer = await stateOf("v0.107.79");
        const older = await stateOf("v0.107.33");
        const shape = commonShape([newer, older]);
        // The same settings, set alike on both: equal once Ecosia and `ignored_enabled` are left out.
        expect(project(newer, shape)).toEqual(project(older, shape));
        expect(project(newer, shape).safesearch).not.toHaveProperty("ecosia");
        expect(generalArea.diff(project(newer, shape), project(older, shape))).toEqual([]);
    });

    it("writes only the parts that differ, each through its own endpoint", async () => {
        const target = await stateOf("v0.107.79");
        const current = { ...target, filtering: { enabled: true, interval: 24 }, safebrowsing: false, stats: { ...target.stats, enabled: false } };
        const steps = generalArea.diff(target, current);
        expect(steps.map((s) => s.part)).toEqual(["filtering", "safebrowsing", "stats"]);
        expect(steps.map((s) => generalArea.describe(s))).toEqual([
            "Filtering switched on, lists updated every 12 h",
            "Safe Browsing switched on",
            "Statistics settings changed",
        ]);

        const { api, writes } = answeringApi(recorded("v0.107.79"));
        await generalArea.apply(api, steps);
        expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
            "POST /control/filtering/config",
            "POST /control/safebrowsing/enable",
            "PUT /control/stats/config/update",
        ]);
        expect(writes[0].body).toEqual({ enabled: true, interval: 12 });
        expect(writes[1].body).toBeUndefined();
    });

    it("writes the primary's settings over the copy's, so a field the cluster does not compare keeps its value", async () => {
        const { api, writes } = answeringApi({ ...recorded("v0.107.79"), "/control/querylog/config": { ignored: [], interval: 1, enabled: false, ignored_enabled: false, anonymize_client_ip: false } });
        // The primary is v0.107.33: its query log settings have no `ignored_enabled`.
        await generalArea.apply(api, [{ part: "querylog", value: { ignored: ["example.org"], interval: 86400000, enabled: true, anonymize_client_ip: true } }]);
        expect(writes[0].body).toEqual({ ignored: ["example.org"], interval: 86400000, enabled: true, ignored_enabled: false, anonymize_client_ip: true });
    });
});
