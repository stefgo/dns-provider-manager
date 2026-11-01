import { describe, expect, it } from "vitest";
import { answeringApi, recorded } from "../../../testing/adguardRecording.js";
import { userRulesArea } from "./userRulesArea.js";

describe("userRulesArea", () => {
    it("reads the custom rules in their order, from either version", async () => {
        for (const version of ["v0.107.79", "v0.107.33"] as const) {
            const raw = await userRulesArea.read(answeringApi(recorded(version)).api);
            expect(userRulesArea.normalise(raw)).toEqual({ rules: ["||ads.example^", "@@||ok.example^"] });
        }
        expect(userRulesArea.normalise({ user_rules: null })).toEqual({ rules: [] });
    });

    it("writes the list as a whole when anything in it differs, its order included", async () => {
        const target = { rules: ["! Ads", "||ads.example^", "", "@@||ok.example^"] };
        expect(userRulesArea.diff(target, target)).toEqual([]);
        const steps = userRulesArea.diff(target, { rules: ["||ads.example^", "! Ads", "", "@@||ok.example^"] });
        expect(steps.map((s) => userRulesArea.describe(s))).toEqual(["Custom filtering rules replaced (2 rules)"]);

        const { api, writes } = answeringApi({});
        await userRulesArea.apply(api, steps);
        expect(writes).toMatchObject([{ method: "POST", path: "/control/filtering/set_rules", body: { rules: target.rules } }]);
    });
});
