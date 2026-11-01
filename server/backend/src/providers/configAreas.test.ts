import { describe, expect, it } from "vitest";
import { CONFIG_AREAS } from "@dpm/shared";
import { configAreaSync, inRunOrder } from "./configAreas.js";

describe("configAreas", () => {
    it("has a sync for every area, under its own name", () => {
        for (const area of CONFIG_AREAS) expect(configAreaSync(area).area).toBe(area);
    });

    it("runs the blocklists before the allowlists, whatever order they were chosen in", () => {
        expect(inRunOrder(["allowlists", "user_rules", "blocklists", "rewrites"])).toEqual(["rewrites", "blocklists", "allowlists", "user_rules"]);
    });
});
