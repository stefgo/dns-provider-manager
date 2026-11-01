import { describe, expect, it } from "vitest";
import { answeringApi, recorded } from "../../../testing/adguardRecording.js";
import { versionAtLeast } from "../adguardMapping.js";
import { blockedServicesArea } from "./blockedServicesArea.js";

describe("blockedServicesArea", () => {
    it("reads the blocked services in one order, with a schedule that names every day", async () => {
        const state = blockedServicesArea.normalise(await blockedServicesArea.read(answeringApi(recorded("v0.107.79")).api));
        expect(state).toEqual({
            ids: ["9gag", "tiktok"],
            schedule: { time_zone: "Europe/Berlin", sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: { start: 0, end: 86340000 } },
        });
    });

    it("needs a version that has the endpoint", async () => {
        expect(versionAtLeast("v0.107.33", blockedServicesArea.minVersion!)).toBe(false);
        expect(versionAtLeast("v0.107.79", blockedServicesArea.minVersion!)).toBe(true);
        await expect(blockedServicesArea.read(answeringApi(recorded("v0.107.33")).api)).rejects.toThrow("AdGuard Home does not know /control/blocked_services/get");
    });

    it("writes the whole list with its schedule, as AdGuard Home takes it", async () => {
        const answers = recorded("v0.107.79");
        const target = blockedServicesArea.normalise(answers["/control/blocked_services/get"]);
        const steps = blockedServicesArea.diff(target, { ...target, ids: [] });
        expect(steps.map((s) => blockedServicesArea.describe(s))).toEqual(["Blocked services set to 9gag, tiktok"]);
        expect(blockedServicesArea.diff(target, target)).toEqual([]);

        const { api, writes } = answeringApi(answers);
        await blockedServicesArea.apply(api, steps);
        expect(writes).toMatchObject([
            { method: "PUT", path: "/control/blocked_services/update", body: { ids: ["9gag", "tiktok"], schedule: { time_zone: "Europe/Berlin", sat: { start: 0, end: 86340000 } } } },
        ]);
    });

    it("refuses a service the copy does not know, before writing anything", async () => {
        const { api, writes } = answeringApi(recorded("v0.107.79"));
        const value = { ids: ["9gag", "new_service"], schedule: { time_zone: "UTC" } };
        await expect(blockedServicesArea.apply(api, [{ kind: "set", value }])).rejects.toThrow(
            "This AdGuard Home does not know the blocked services new_service; update it to the primary's version",
        );
        expect(writes).toEqual([]);
    });
});
