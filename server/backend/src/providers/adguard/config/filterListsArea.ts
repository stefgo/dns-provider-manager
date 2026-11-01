import type { ConfigAreaSync } from "../../ConfigAreaSync.js";
import type { AdGuardApi } from "../AdGuardApi.js";
import { objectOf } from "./shapes.js";

/**
 * *Filters → DNS blocklists* and *DNS allowlists*: one code for both, told apart by
 * `whitelist`. A list is told by its URL -- its id differs from one instance to the next --
 * and compared by name and whether it is on. When the rules were last downloaded, and how many
 * there are, belongs to the instance.
 *
 * AdGuard Home holds a URL once across both kinds: a list that moved from one kind to the other
 * at the primary can be added at a copy only once the other area has removed it there.
 */
export interface FilterList {
    url: string;
    name: string;
    enabled: boolean;
}

export interface FilterListsState {
    /** By URL. */
    lists: FilterList[];
}

export type FilterListsStep =
    | { kind: "remove"; list: FilterList }
    | { kind: "change"; list: FilterList }
    | { kind: "add"; list: FilterList };

/**
 * Adding a list makes AdGuard Home download and check it before it answers, which takes as long
 * as the list is large and the server holding it slow.
 */
const ADD_TIMEOUT_MS = 120_000;

function listsOf(raw: unknown): FilterList[] {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error("AdGuard Home sent no list of filter lists");
    return raw
        .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && typeof item.url === "string")
        .map((item) => ({ url: item.url as string, name: typeof item.name === "string" ? item.name : "", enabled: item.enabled === true }))
        .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

function filterListsArea(area: "blocklists" | "allowlists"): ConfigAreaSync<AdGuardApi, FilterListsState, FilterListsStep> {
    const whitelist = area === "allowlists";
    const noun = whitelist ? "Allowlist" : "Blocklist";
    return {
        area,
        minVersion: null,

        read(api) {
            return api.json("/control/filtering/status");
        },

        normalise(raw) {
            const status = objectOf(raw, "filtering status");
            return { lists: listsOf(whitelist ? status.whitelist_filters : status.filters) };
        },

        diff(target, current) {
            const wanted = new Map(target.lists.map((list) => [list.url, list]));
            const held = new Map(current.lists.map((list) => [list.url, list]));
            const steps: FilterListsStep[] = current.lists.filter((list) => !wanted.has(list.url)).map((list) => ({ kind: "remove", list }));
            for (const list of target.lists) {
                const before = held.get(list.url);
                if (!before) steps.push({ kind: "add", list });
                else if (before.name !== list.name || before.enabled !== list.enabled) steps.push({ kind: "change", list });
            }
            return steps;
        },

        async apply(api, steps) {
            for (const { kind, list } of steps) {
                switch (kind) {
                    case "remove":
                        await api.call("/control/filtering/remove_url", "POST", { url: list.url, whitelist });
                        break;
                    case "add":
                        await api.call("/control/filtering/add_url", "POST", { name: list.name, url: list.url, whitelist }, ADD_TIMEOUT_MS);
                        // A list is added switched on.
                        if (!list.enabled) await setList(api, list, whitelist);
                        break;
                    case "change":
                        await setList(api, list, whitelist);
                        break;
                }
            }
        },

        describe({ kind, list }) {
            const label = `${noun} "${list.name || list.url}"`;
            switch (kind) {
                case "remove":
                    return `${label} removed`;
                case "add":
                    return `${label} added${list.enabled ? "" : ", switched off"}`;
                case "change":
                    return `${label} changed${list.enabled ? "" : ", switched off"}`;
            }
        },
    };
}

function setList(api: AdGuardApi, list: FilterList, whitelist: boolean) {
    return api.call("/control/filtering/set_url", "POST", { url: list.url, whitelist, data: { name: list.name, url: list.url, enabled: list.enabled } });
}

export const blocklistsArea = filterListsArea("blocklists");
export const allowlistsArea = filterListsArea("allowlists");
