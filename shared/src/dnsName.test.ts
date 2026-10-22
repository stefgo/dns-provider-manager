import { describe, expect, it } from "vitest";
import { dnsNameError, isInZone, normaliseDnsName } from "./dnsName.js";
import { ProviderInputSchema, RecordInputSchema, hostPortError, providerSecretMissing } from "./schemas.js";

describe("normaliseDnsName", () => {
    it("writes a name in lower case, without the trailing dot", () => {
        expect(normaliseDnsName(" App.Example.COM. ")).toBe("app.example.com");
    });
});

describe("dnsNameError", () => {
    it("takes host names, single labels and punycode", () => {
        expect(dnsNameError("app.example.com")).toBeNull();
        expect(dnsNameError("nas")).toBeNull();
        expect(dnsNameError("xn--bcher-kva.example")).toBeNull();
        expect(dnsNameError("a-1.b2")).toBeNull();
    });

    it("refuses what a host name cannot hold", () => {
        expect(dnsNameError("")).toBe("Enter a name");
        expect(dnsNameError("app..example.com")).toBe("A name has no empty part between two dots");
        expect(dnsNameError("-app.example.com")).toMatch(/not start or end with a hyphen/);
        expect(dnsNameError("app_1.example.com")).toMatch(/only letters, digits and hyphens/);
        expect(dnsNameError(`${"a".repeat(64)}.example.com`)).toMatch(/longer than 63 characters/);
        expect(dnsNameError(`${"a.".repeat(127)}ab`)).toBe("At most 253 characters");
    });

    it("takes * only as the first label, and only where it is allowed", () => {
        expect(dnsNameError("*.lab.example.com", { wildcard: true })).toBeNull();
        expect(dnsNameError("*.lab.example.com")).toBe("No * here");
        expect(dnsNameError("lab.*.example.com", { wildcard: true })).toBe("* stands only at the start");
        expect(dnsNameError("*", { wildcard: true })).toBe("* needs a domain after it");
    });
});

describe("isInZone", () => {
    it("is the zone itself and every name below it, not a name that merely ends alike", () => {
        expect(isInZone("example.com", "example.com")).toBe(true);
        expect(isInZone("app.example.com", "example.com")).toBe(true);
        expect(isInZone("badexample.com", "example.com")).toBe(false);
    });
});

describe("RecordInputSchema", () => {
    const base = { name: "App.Example.com.", type: "A", value: " 192.168.1.10 ", siteIds: ["s1", "s1"] } as const;

    it("stores the name and value normalised, the sites once, and defaults the rest", () => {
        expect(RecordInputSchema.parse(base)).toEqual({
            name: "app.example.com",
            type: "A",
            value: "192.168.1.10",
            ttl: null,
            proxied: false,
            siteIds: ["s1"],
            note: "",
        });
    });

    it("checks the value against the type", () => {
        const issue = (over: object) => RecordInputSchema.safeParse({ ...base, ...over }).error?.issues[0];
        expect(issue({ value: "2001:db8::1" })).toMatchObject({ path: ["value"], message: /IPv4/ });
        expect(issue({ type: "AAAA", value: "192.168.1.10" })).toMatchObject({ path: ["value"], message: /IPv6/ });
        expect(issue({ type: "CNAME", value: "*.example.com" })).toMatchObject({ path: ["value"], message: "No * here" });
        expect(issue({ type: "CNAME", value: "APP.example.com." })).toMatchObject({ message: "A CNAME cannot point to its own name" });
    });

    it("writes an IPv6 address and a CNAME target as they are stored", () => {
        expect(RecordInputSchema.parse({ ...base, type: "AAAA", value: "2001:DB8::A" }).value).toBe("2001:db8::a");
        expect(RecordInputSchema.parse({ ...base, type: "CNAME", value: "Web.Example.com." }).value).toBe("web.example.com");
    });

    it("needs a site and a TTL in range", () => {
        expect(RecordInputSchema.safeParse({ ...base, siteIds: [] }).error?.issues[0].message).toBe("Choose at least one site");
        expect(RecordInputSchema.safeParse({ ...base, ttl: 30 }).error?.issues[0].message).toBe("At least 60 seconds");
        expect(RecordInputSchema.safeParse({ ...base, ttl: 300 }).success).toBe(true);
    });
});

describe("hostPortError", () => {
    it("takes a name, an IPv4 address or a bracketed IPv6 address, each with a port", () => {
        for (const ok of ["dc1.ad.example.com", "dc1:636", "10.0.0.5", "10.0.0.5:3269", "[2001:db8::5]", "[2001:db8::5]:636"]) {
            expect(hostPortError(ok), ok).toBeNull();
        }
    });

    it("refuses a URL, a bad port and a bad address", () => {
        expect(hostPortError("ldaps://dc1")).toMatch(/not a host or host:port/);
        expect(hostPortError("dc1:70000")).toBe("Port 70000 is not between 1 and 65535");
        expect(hostPortError("10.0.0.256")).toBe("10.0.0.256 is not an IPv4 address");
    });
});

describe("ProviderInputSchema", () => {
    it("takes each type with its own fields and defaults", () => {
        expect(ProviderInputSchema.parse({ type: "cloudflare", name: "Cloudflare", secret: "t" })).toEqual({
            type: "cloudflare",
            name: "Cloudflare",
            secret: "t",
            autoCorrect: false,
            zoneMode: "all",
            zoneIds: [],
        });
        expect(
            ProviderInputSchema.parse({ type: "adguard", name: "AdGuard 1", url: "http://10.0.0.2:3000", username: "admin" }),
        ).toMatchObject({ allowSelfSigned: false });
    });

    it("refuses what does not belong to the type", () => {
        expect(ProviderInputSchema.safeParse({ type: "adguard", name: "a", url: "ftp://x", username: "u" }).success).toBe(false);
        expect(ProviderInputSchema.safeParse({ type: "samba-ad", name: "a", servers: [], username: "u" }).success).toBe(false);
        expect(ProviderInputSchema.safeParse({ type: "bind", name: "a" }).success).toBe(false);
    });

    it("says what a new provider lacks without a secret", () => {
        expect(providerSecretMissing({ type: "cloudflare" })).toBe("Enter the API token");
        expect(providerSecretMissing({ type: "adguard" })).toBe("Enter the password");
        expect(providerSecretMissing({ type: "adguard", secret: "x" })).toBeNull();
    });
});
