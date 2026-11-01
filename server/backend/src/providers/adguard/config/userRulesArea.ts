import type { ConfigAreaSync } from "../../ConfigAreaSync.js";
import type { AdGuardApi } from "../AdGuardApi.js";
import { objectOf, stringList } from "./shapes.js";

/**
 * *Filters → Custom filtering rules*: one list, written as a whole, in the primary's order --
 * comments and empty lines included, since a rule's place among them is what a reader goes by.
 */
export interface UserRulesState {
    rules: string[];
}

export type UserRulesStep = { kind: "set"; rules: string[] };

export const userRulesArea: ConfigAreaSync<AdGuardApi, UserRulesState, UserRulesStep> = {
    area: "user_rules",
    minVersion: null,

    read(api) {
        return api.json("/control/filtering/status");
    },

    normalise(raw) {
        return { rules: stringList(objectOf(raw, "filtering status").user_rules) };
    },

    diff(target, current) {
        const same = target.rules.length === current.rules.length && target.rules.every((rule, i) => rule === current.rules[i]);
        return same ? [] : [{ kind: "set", rules: target.rules }];
    },

    async apply(api, steps) {
        for (const { rules } of steps) await api.call("/control/filtering/set_rules", "POST", { rules });
    },

    describe({ rules }) {
        const count = rules.filter((rule) => rule.trim() !== "" && !rule.trimStart().startsWith("!") && !rule.trimStart().startsWith("#")).length;
        return `Custom filtering rules replaced (${count === 1 ? "1 rule" : `${count} rules`})`;
    },
};
