import type { ConfigAreaSync } from "../../ConfigAreaSync.js";
import type { AdGuardApi } from "../AdGuardApi.js";
import { canonicalEqual } from "../../configState.js";
import { mergeOver, objectOf, sortedList, type Json, type JsonObject } from "./shapes.js";

/**
 * *Settings → General settings*: filtering and how often the lists are updated, Safe Browsing,
 * parental control, Safe Search, the query log and the statistics. Each is read and written
 * through endpoints of its own, so a change writes only the part that differs.
 */
export interface GeneralState {
    filtering: { enabled: boolean; interval: number };
    safebrowsing: boolean;
    parental: boolean;
    /** `enabled` and one switch per search engine; newer versions know more engines. */
    safesearch: JsonObject;
    /** As AdGuard Home sends it, the hosts it ignores in one order. */
    querylog: JsonObject;
    stats: JsonObject;
}

type Part = keyof GeneralState;

export type GeneralStep = { [P in Part]: { part: P; value: GeneralState[P] } }[Part];

const PARTS: readonly Part[] = ["filtering", "safebrowsing", "parental", "safesearch", "querylog", "stats"];

const enabledOf = (raw: unknown, what: string) => objectOf(raw, what).enabled === true;

const withSortedIgnored = (raw: unknown, what: string): JsonObject => {
    const settings = objectOf(raw, what);
    return { ...settings, ignored: sortedList(settings.ignored) };
};

export const generalArea: ConfigAreaSync<AdGuardApi, GeneralState, GeneralStep> = {
    area: "general",
    minVersion: null,

    async read(api) {
        return {
            filtering: await api.json("/control/filtering/status"),
            safebrowsing: await api.json("/control/safebrowsing/status"),
            parental: await api.json("/control/parental/status"),
            safesearch: await api.json("/control/safesearch/status"),
            querylog: await api.json("/control/querylog/config"),
            stats: await api.json("/control/stats/config"),
        };
    },

    normalise(raw) {
        const answers = objectOf(raw, "general settings");
        const filtering = objectOf(answers.filtering, "filtering status");
        return {
            filtering: { enabled: filtering.enabled === true, interval: typeof filtering.interval === "number" ? filtering.interval : 24 },
            safebrowsing: enabledOf(answers.safebrowsing, "Safe Browsing status"),
            parental: enabledOf(answers.parental, "parental control status"),
            safesearch: objectOf(answers.safesearch, "Safe Search status"),
            querylog: withSortedIgnored(answers.querylog, "query log settings"),
            stats: withSortedIgnored(answers.stats, "statistics settings"),
        };
    },

    diff(target, current) {
        return PARTS.filter((part) => !canonicalEqual(target[part], current[part])).map((part) => ({ part, value: target[part] }) as GeneralStep);
    },

    async apply(api, steps) {
        for (const step of steps) {
            switch (step.part) {
                case "filtering":
                    await api.call("/control/filtering/config", "POST", step.value);
                    break;
                case "safebrowsing":
                case "parental":
                    await api.call(`/control/${step.part}/${step.value ? "enable" : "disable"}`, "POST");
                    break;
                case "safesearch":
                    await api.call("/control/safesearch/settings", "PUT", mergeOver(await current(api, "/control/safesearch/status"), step.value));
                    break;
                case "querylog":
                    await api.call("/control/querylog/config/update", "PUT", mergeOver(await current(api, "/control/querylog/config"), step.value));
                    break;
                case "stats":
                    await api.call("/control/stats/config/update", "PUT", mergeOver(await current(api, "/control/stats/config"), step.value));
                    break;
            }
        }
    },

    describe(step) {
        switch (step.part) {
            case "filtering":
                return step.value.enabled ? `Filtering switched on, lists updated every ${step.value.interval} h` : "Filtering switched off";
            case "safebrowsing":
                return `Safe Browsing switched ${step.value ? "on" : "off"}`;
            case "parental":
                return `Parental control switched ${step.value ? "on" : "off"}`;
            case "safesearch":
                return step.value.enabled === true ? "Safe Search changed" : "Safe Search switched off";
            case "querylog":
                return "Query log settings changed";
            case "stats":
                return "Statistics settings changed";
        }
    },
};

/** What the copy holds now, as the base the primary's state is written over. */
async function current(api: AdGuardApi, path: string): Promise<Json> {
    return objectOf(await api.json(path), "settings");
}
