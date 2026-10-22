import { describe, expect, it } from "vitest";
import { recordTargets, type TargetProvider } from "./recordTargets.js";

const SEEN = "2026-10-01T00:00:00.000Z";
const adguard = (id: string): TargetProvider => ({ id, name: id, type: "adguard", zones: [], lastSeenAt: SEEN });
const cloudflare = (id: string, zones: string[], lastSeenAt: string | null = SEEN): TargetProvider => ({
    id,
    name: id,
    type: "cloudflare",
    zones: zones.map((name) => ({ id: `${id}:${name}`, name, owner: id })),
    lastSeenAt,
});

describe("recordTargets", () => {
    it("sends a record to every provider without zones, and to the one whose zone holds its name", () => {
        const providers = [adguard("ag1"), adguard("ag2"), cloudflare("cf", ["example.com"])];
        const sites = [{ id: "s", name: "all", providerIds: ["ag1", "ag2", "cf"] }];
        expect(recordTargets({ name: "app.example.com", siteIds: ["s"] }, sites, providers)).toEqual({
            targets: [
                { providerId: "ag1", zone: null },
                { providerId: "ag2", zone: null },
                { providerId: "cf", zone: { id: "cf:example.com", name: "example.com" } },
            ],
            skipped: [],
            refusal: null,
        });
    });

    it("takes the longest zone among nested ones, and names the provider passed over", () => {
        const providers = [cloudflare("a", ["example.com"]), cloudflare("b", ["lab.example.com"])];
        const sites = [{ id: "s", name: "external", providerIds: ["a", "b"] }];
        const result = recordTargets({ name: "x.lab.example.com", siteIds: ["s"] }, sites, providers);
        expect(result.targets).toEqual([{ providerId: "b", zone: { id: "b:lab.example.com", name: "lab.example.com" } }]);
        expect(result.skipped).toEqual([{ providerId: "a", reason: "Goes to b instead, whose zone lab.example.com is closer" }]);
    });

    it("counts only the zones a provider uses", () => {
        const provider = { ...cloudflare("a", []), zones: [{ id: "z", name: "example.com", owner: "other" }] };
        const sites = [{ id: "s", name: "external", providerIds: ["a"] }];
        expect(recordTargets({ name: "app.example.com", siteIds: ["s"] }, sites, [provider]).refusal).toBe(
            'app.example.com lies in none of the zones the site "external" writes to',
        );
    });

    it("refuses a name no provider of a site takes, but not next to AdGuard Home", () => {
        const providers = [adguard("ag"), cloudflare("cf", ["example.com"])];
        const internal = { id: "i", name: "internal", providerIds: ["ag", "cf"] };
        const external = { id: "e", name: "external", providerIds: ["cf"] };
        const inner = recordTargets({ name: "nas.lan", siteIds: ["i"] }, [internal, external], providers);
        expect(inner.targets).toEqual([{ providerId: "ag", zone: null }]);
        expect(inner.skipped).toEqual([{ providerId: "cf", reason: "Lies in none of the zones it uses" }]);
        expect(inner.refusal).toBeNull();
        expect(recordTargets({ name: "nas.lan", siteIds: ["e"] }, [internal, external], providers).refusal).toBe(
            'nas.lan lies in none of the zones the site "external" writes to',
        );
    });

    it("waits for a provider whose zones were never read, rather than refusing", () => {
        const sites = [{ id: "s", name: "external", providerIds: ["cf"] }];
        const result = recordTargets({ name: "app.example.com", siteIds: ["s"] }, sites, [cloudflare("cf", [], null)]);
        expect(result).toEqual({
            targets: [],
            skipped: [{ providerId: "cf", reason: "Its zones have not been read yet" }],
            refusal: null,
        });
    });

    it("goes nowhere from a site without providers, and is not refused for it", () => {
        const sites = [{ id: "s", name: "empty", providerIds: [] }];
        expect(recordTargets({ name: "app.example.com", siteIds: ["s"] }, sites, [])).toEqual({ targets: [], skipped: [], refusal: null });
    });

    it("joins the targets of several sites, and drops a skip another site made a target", () => {
        const providers = [adguard("ag"), cloudflare("a", ["example.com"]), cloudflare("b", ["lab.example.com"])];
        const sites = [
            { id: "s1", name: "one", providerIds: ["a", "b"] },
            { id: "s2", name: "two", providerIds: ["a", "ag"] },
        ];
        // In "one", b is closer; in "two", a is the only one with zones.
        const result = recordTargets({ name: "x.lab.example.com", siteIds: ["s1", "s2"] }, sites, providers);
        expect(result.targets.map((t) => t.providerId).sort()).toEqual(["a", "ag", "b"]);
        expect(result.skipped).toEqual([]);
    });
});
