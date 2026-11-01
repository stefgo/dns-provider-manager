import type { ConfigAreaSync } from "../../ConfigAreaSync.js";
import type { AdGuardApi } from "../AdGuardApi.js";
import { hasRewriteSettings } from "../adguardMapping.js";
import { objectOf } from "./shapes.js";

/**
 * *Filters → DNS rewrites*: every rewrite, those dpm manages and the others alike, and the
 * switch that turns all of them off at once.
 *
 * AdGuard Home tells a rewrite only by its domain and answer and adds the same pair twice, so
 * the rewrites are a list with repeats, sorted. `enabled` exists from v0.107.68 on, for each
 * rewrite and as the switch; an older version has neither, and a cluster with one compares
 * without them (`commonShape`).
 */
export interface Rewrite {
    domain: string;
    answer: string;
    enabled?: boolean;
}

export interface RewritesState {
    /** The switch for all rewrites; missing where the version has none. */
    enabled?: boolean;
    rewrites: Rewrite[];
}

export type RewritesStep =
    /** Removes every rewrite of this domain and answer: AdGuard Home removes repeats together. */
    | { kind: "delete"; domain: string; answer: string }
    | { kind: "add"; rewrite: Rewrite }
    | { kind: "update"; rewrite: Rewrite & { enabled: boolean } }
    | { kind: "switch"; enabled: boolean };

const keyOf = (r: Pick<Rewrite, "domain" | "answer">) => JSON.stringify([r.domain, r.answer]);

const compare = (a: Rewrite, b: Rewrite) =>
    a.domain.localeCompare(b.domain) || a.answer.localeCompare(b.answer) || String(a.enabled).localeCompare(String(b.enabled));

/** The rewrites of a state by domain and answer, each with what its repeats say of `enabled`. */
function grouped(rewrites: readonly Rewrite[]): Map<string, Rewrite[]> {
    const groups = new Map<string, Rewrite[]>();
    for (const rewrite of rewrites) groups.set(keyOf(rewrite), [...(groups.get(keyOf(rewrite)) ?? []), rewrite]);
    return groups;
}

const sameGroup = (a: readonly Rewrite[], b: readonly Rewrite[]) => a.length === b.length && a.every((r, i) => r.enabled === b[i].enabled);

const named = (r: Pick<Rewrite, "domain" | "answer">) => `${r.domain} → ${r.answer}`;

export const rewritesArea: ConfigAreaSync<AdGuardApi, RewritesState, RewritesStep> = {
    area: "rewrites",
    // The oldest version dpm writes rewrites to at all (`MIN_VERSION`).
    minVersion: "v0.107.33",

    async read(api) {
        const list = await api.json("/control/rewrite/list");
        const version = await api.version();
        const settings = version && hasRewriteSettings(version) ? await api.json("/control/rewrite/settings") : undefined;
        return { list, settings };
    },

    normalise(raw) {
        const { list, settings } = objectOf(raw, "rewrites") as { list?: unknown; settings?: unknown };
        if (!Array.isArray(list)) throw new Error("AdGuard Home sent no list of rewrites");
        const rewrites = list
            .filter((r): r is { domain: string; answer: string; enabled?: unknown } => typeof r?.domain === "string" && typeof r?.answer === "string")
            .map((r): Rewrite => (typeof r.enabled === "boolean" ? { domain: r.domain, answer: r.answer, enabled: r.enabled } : { domain: r.domain, answer: r.answer }))
            .sort(compare);
        const state: RewritesState = { rewrites };
        if (settings !== undefined) {
            const enabled = objectOf(settings, "rewrite settings").enabled;
            if (typeof enabled === "boolean") state.enabled = enabled;
        }
        return state;
    },

    diff(target, current) {
        const deletes: RewritesStep[] = [];
        const updates: RewritesStep[] = [];
        const adds: RewritesStep[] = [];
        const want = grouped(target.rewrites);
        const have = grouped(current.rewrites);
        for (const [key, there] of have) {
            const wanted = want.get(key) ?? [];
            if (sameGroup(wanted, there)) continue;
            if (wanted.length === 1 && there.length === 1 && wanted[0].enabled !== undefined) {
                updates.push({ kind: "update", rewrite: { ...wanted[0], enabled: wanted[0].enabled } });
                continue;
            }
            // Repeats cannot be told apart: all of them go, and what the primary holds is added.
            deletes.push({ kind: "delete", domain: there[0].domain, answer: there[0].answer });
            for (const rewrite of wanted) adds.push({ kind: "add", rewrite });
        }
        for (const [key, wanted] of want) {
            if (!have.has(key)) for (const rewrite of wanted) adds.push({ kind: "add", rewrite });
        }
        const steps = [...deletes, ...updates, ...adds];
        if (target.enabled !== undefined && current.enabled !== undefined && target.enabled !== current.enabled) {
            steps.push({ kind: "switch", enabled: target.enabled });
        }
        return steps;
    },

    async apply(api, steps) {
        for (const step of steps) {
            switch (step.kind) {
                case "delete":
                    await api.call("/control/rewrite/delete", "POST", { domain: step.domain, answer: step.answer });
                    break;
                case "add":
                    await api.call("/control/rewrite/add", "POST", step.rewrite);
                    break;
                case "update": {
                    const { domain, answer } = step.rewrite;
                    await api.call("/control/rewrite/update", "PUT", { target: { domain, answer }, update: step.rewrite });
                    break;
                }
                case "switch":
                    await api.call("/control/rewrite/settings/update", "PUT", { enabled: step.enabled });
                    break;
            }
        }
    },

    describe(step) {
        switch (step.kind) {
            case "delete":
                return `Rewrite ${named(step)} removed`;
            case "add":
                return `Rewrite ${named(step.rewrite)} added${step.rewrite.enabled === false ? ", switched off" : ""}`;
            case "update":
                return `Rewrite ${named(step.rewrite)} switched ${step.rewrite.enabled ? "on" : "off"}`;
            case "switch":
                return `All rewrites switched ${step.enabled ? "on" : "off"}`;
        }
    },
};
