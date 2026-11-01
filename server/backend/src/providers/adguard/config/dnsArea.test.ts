import { describe, expect, it } from "vitest";
import { answeringApi, recorded } from "../../../testing/adguardRecording.js";
import { commonShape, project } from "../../configState.js";
import { dnsArea, pausedUntilOf, protectionRequest } from "./dnsArea.js";

const stateOf = async (answers: Record<string, unknown>) => dnsArea.normalise(await dnsArea.read(answeringApi(answers).api));

describe("dnsArea", () => {
    it("reads the DNS settings without the protection and what AdGuard Home finds itself", async () => {
        const state = await stateOf(recorded("v0.107.79"));
        expect(state.settings).toMatchObject({ upstream_dns: ["9.9.9.9", "[/lan/]192.168.1.1"], cache_size: 1000, upstream_mode: "" });
        expect(state.settings).not.toHaveProperty("protection_enabled");
        expect(state.settings).not.toHaveProperty("protection_disabled_until");
        expect(state.settings).not.toHaveProperty("default_local_ptr_upstreams");
        expect(state.protection).toEqual({ enabled: false, pausedUntil: "2026-10-31T21:24:00.000Z" });
        expect(state.access).toEqual({ allowed_clients: [], disallowed_clients: ["10.9.9.9"], blocked_hosts: ["version.bind"] });
    });

    it("reads an empty list sent as null as empty, and load balancing in the form every version takes", async () => {
        const answers = recorded("v0.107.79");
        const info = answers["/control/dns_info"] as Record<string, unknown>;
        const state = await stateOf({
            ...answers,
            "/control/dns_info": { ...info, fallback_dns: null, upstream_mode: "load_balance" },
            "/control/access/list": { allowed_clients: null, disallowed_clients: null, blocked_hosts: ["b", "a"] },
        });
        expect(state.settings.fallback_dns).toEqual([]);
        expect(state.settings.upstream_mode).toBe("");
        expect(state.access).toEqual({ allowed_clients: [], disallowed_clients: [], blocked_hosts: ["a", "b"] });
    });

    it("compares an older instance on the settings both know", async () => {
        const newer = await stateOf(recorded("v0.107.79"));
        const older = await stateOf(recorded("v0.107.33"));
        const shape = commonShape([newer, older]);
        const steps = dnsArea.diff(project(newer, shape), project(older, shape));
        // Both paused alike; only DNSSEC was left at each version's default.
        expect(steps).toEqual([{ kind: "settings", changes: { dnssec_enabled: true } }]);
        expect(dnsArea.describe(steps[0])).toBe("DNS settings changed: dnssec_enabled");
    });

    it("writes changed settings as a partial update, then the access lists and the protection", async () => {
        const target = await stateOf(recorded("v0.107.79"));
        const current = {
            settings: { ...target.settings, cache_size: 4194304, upstream_dns: ["1.1.1.1"] },
            protection: { enabled: true, pausedUntil: null },
            access: { ...target.access, disallowed_clients: [] },
        };
        const steps = dnsArea.diff(target, current);
        expect(steps).toEqual([
            { kind: "settings", changes: { cache_size: 1000, upstream_dns: ["9.9.9.9", "[/lan/]192.168.1.1"] } },
            { kind: "access", value: target.access },
            { kind: "protection", enabled: false, pausedUntil: "2026-10-31T21:24:00.000Z" },
        ]);
        expect(dnsArea.describe(steps[2])).toBe("Protection paused until 2026-10-31T21:24:00.000Z");
        const { api, writes } = answeringApi({});
        await dnsArea.apply(api, steps.slice(0, 2));
        expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(["POST /control/dns_config", "POST /control/access/set"]);
    });
});

describe("the protection pause", () => {
    it("is compared by the minute it ends in", () => {
        expect(pausedUntilOf("2026-10-31T21:23:45.09719163Z")).toBe("2026-10-31T21:24:00.000Z");
        expect(pausedUntilOf("2026-10-31T21:24:00Z")).toBe("2026-10-31T21:24:00.000Z");
        expect(pausedUntilOf(null)).toBeNull();
    });

    it("is written as the time left, ending a little before the rounded minute", () => {
        const now = Date.parse("2026-10-31T21:00:00Z");
        expect(protectionRequest({ enabled: false, pausedUntil: "2026-10-31T21:24:00.000Z" }, now)).toEqual({ enabled: false, duration: 24 * 60_000 - 5_000 });
        // Ended while it was on its way: protection on, as at the primary by now.
        expect(protectionRequest({ enabled: false, pausedUntil: "2026-10-31T21:00:03.000Z" }, now)).toEqual({ enabled: true });
        expect(protectionRequest({ enabled: false, pausedUntil: null }, now)).toEqual({ enabled: false });
        expect(protectionRequest({ enabled: true, pausedUntil: null }, now)).toEqual({ enabled: true });
    });

    it("written at a copy reads back in the primary's minute", () => {
        const now = Date.parse("2026-10-31T21:00:00Z");
        const request = protectionRequest({ enabled: false, pausedUntil: "2026-10-31T21:24:00.000Z" }, now) as { duration: number };
        // The copy counts from when it got the request, a second later, by a clock two seconds ahead.
        const atCopy = new Date(now + 1_000 + 2_000 + request.duration).toISOString();
        expect(pausedUntilOf(atCopy)).toBe("2026-10-31T21:24:00.000Z");
    });
});
