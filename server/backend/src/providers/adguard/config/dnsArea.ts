import type { ConfigAreaSync } from "../../ConfigAreaSync.js";
import { canonicalEqual } from "../../configState.js";
import type { AdGuardApi } from "../AdGuardApi.js";
import { listed, objectOf, sortedList, stringList, type Json, type JsonObject } from "./shapes.js";

/**
 * *Settings → DNS settings*: upstreams, bootstrap and private resolvers, rate limit, blocking
 * mode, cache, the access lists -- and the protection switch with a pause that is running,
 * which lives in the same answer.
 *
 * TLS and DHCP are not part of it: certificates and interfaces belong to the instance.
 */
export interface DnsState {
    /** `dns_info` without the protection and the read-only fields. */
    settings: JsonObject;
    protection: {
        enabled: boolean;
        /** End of a pause, rounded up to the minute; null while protection is on or off for good. */
        pausedUntil: string | null;
    };
    access: { allowed_clients: string[]; disallowed_clients: string[]; blocked_hosts: string[] };
}

export type DnsStep =
    | { kind: "settings"; changes: JsonObject }
    | { kind: "protection"; enabled: boolean; pausedUntil: string | null }
    | { kind: "access"; value: DnsState["access"] };

/** Not part of `settings`: the protection is a part of its own, and what AdGuard Home finds for itself. */
const LEFT_OUT = new Set(["protection_enabled", "protection_disabled_until", "default_local_ptr_upstreams"]);

/** Lists of servers and addresses, sent as `null` while empty by some versions. */
const LISTS = new Set(["upstream_dns", "bootstrap_dns", "fallback_dns", "local_ptr_upstreams", "ratelimit_whitelist"]);

/** Lists whose order AdGuard Home does not use; upstreams and bootstrap servers keep theirs. */
const UNORDERED = new Set(["ratelimit_whitelist"]);

/**
 * How much earlier than the primary's a copy's pause is set to end. Each instance counts the
 * pause by its own clock from the moment it gets it: ending a little before the rounded minute
 * keeps the copy's end in the same minute as the primary's for any delay or clock difference
 * below this.
 */
const PAUSE_MARGIN_MS = 5_000;

const MINUTE_MS = 60_000;

/** `2026-10-31T21:23:45.097Z` → `2026-10-31T21:24:00.000Z`. */
export function pausedUntilOf(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const time = Date.parse(raw);
    if (!Number.isFinite(time)) return null;
    return new Date(Math.ceil(time / MINUTE_MS) * MINUTE_MS).toISOString();
}

export const dnsArea: ConfigAreaSync<AdGuardApi, DnsState, DnsStep> = {
    area: "dns",
    minVersion: null,

    async read(api) {
        return { info: await api.json("/control/dns_info"), access: await api.json("/control/access/list") };
    },

    normalise(raw) {
        const answers = objectOf(raw, "DNS settings");
        const info = objectOf(answers.info, "DNS settings");
        const access = objectOf(answers.access, "access lists");
        const settings: JsonObject = {};
        for (const [key, value] of Object.entries(info)) {
            if (LEFT_OUT.has(key)) continue;
            if (UNORDERED.has(key)) settings[key] = sortedList(value);
            else if (LISTS.has(key)) settings[key] = stringList(value);
            else settings[key] = value;
        }
        // Load balancing reads as "" and is written as "": v0.107.33 refuses "load_balance".
        if (settings.upstream_mode === "load_balance") settings.upstream_mode = "";
        const enabled = info.protection_enabled !== false;
        return {
            settings,
            protection: { enabled, pausedUntil: enabled ? null : pausedUntilOf(info.protection_disabled_until) },
            access: {
                allowed_clients: sortedList(access.allowed_clients),
                disallowed_clients: sortedList(access.disallowed_clients),
                blocked_hosts: sortedList(access.blocked_hosts),
            },
        };
    },

    diff(target, current) {
        const steps: DnsStep[] = [];
        const changes: JsonObject = {};
        for (const [key, value] of Object.entries(target.settings)) {
            if (!canonicalEqual(value, current.settings[key])) changes[key] = value;
        }
        if (Object.keys(changes).length > 0) steps.push({ kind: "settings", changes });
        if (!canonicalEqual(target.access, current.access)) steps.push({ kind: "access", value: target.access });
        if (!canonicalEqual(target.protection, current.protection)) steps.push({ kind: "protection", ...target.protection });
        return steps;
    },

    async apply(api, steps) {
        for (const step of steps) {
            switch (step.kind) {
                case "settings":
                    await api.call("/control/dns_config", "POST", step.changes);
                    break;
                case "access":
                    await api.call("/control/access/set", "POST", step.value);
                    break;
                case "protection":
                    await api.call("/control/protection", "POST", protectionRequest(step, Date.now()));
                    break;
            }
        }
    },

    describe(step) {
        switch (step.kind) {
            case "settings":
                return `DNS settings changed: ${listed(Object.keys(step.changes).sort())}`;
            case "access":
                return "Access lists changed";
            case "protection":
                if (step.enabled) return "Protection switched on";
                return step.pausedUntil ? `Protection paused until ${step.pausedUntil}` : "Protection switched off";
        }
    },
};

/** What `/control/protection` is sent: a pause as the time left, a pause that ended as protection on. */
export function protectionRequest(step: { enabled: boolean; pausedUntil: string | null }, now: number): Json {
    if (step.enabled) return { enabled: true };
    if (step.pausedUntil === null) return { enabled: false };
    const duration = Date.parse(step.pausedUntil) - PAUSE_MARGIN_MS - now;
    return duration > 0 ? { enabled: false, duration } : { enabled: true };
}
