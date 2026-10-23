import { describe, expect, it } from "vitest";
import type { Provider } from "@dpm/shared";
import { accessDetails, connectionDetails, readTone, usedZones } from "./providerDetails";

const common = {
    id: "p1",
    name: "Provider",
    autoCorrect: false,
    readOnly: false,
    writable: true,
    hasSecret: true,
    siteIds: [],
    createdAt: "2026-10-22T10:00:00Z",
    updatedAt: null,
    lastSeenAt: null,
    lastError: null,
    zones: [],
    readable: true,
};

const cloudflare: Provider = { ...common, type: "cloudflare", zoneMode: "selected", zoneIds: [] };
const adguard: Provider = { ...common, type: "adguard", url: "http://adguard.lan", username: "admin", allowSelfSigned: false };
const samba: Provider = {
    ...common,
    type: "samba-ad",
    servers: ["dc1.ad.example.com", "dc2.ad.example.com"],
    username: "dpm@ad.example.com",
    allowSelfSigned: true,
};

describe("readTone", () => {
    it("is neutral before the first reading", () => {
        expect(readTone({ lastSeenAt: null, lastError: null })).toBe("neutral");
    });

    it("is success after a reading that worked", () => {
        expect(readTone({ lastSeenAt: "2026-10-22T10:00:00Z", lastError: null })).toBe("success");
    });

    it("is error after a reading that failed, whatever came before", () => {
        expect(readTone({ lastSeenAt: "2026-10-22T10:00:00Z", lastError: "timeout" })).toBe("error");
    });
});

describe("usedZones", () => {
    it("keeps the zones the provider uses and drops those another one uses", () => {
        const zones = [
            { id: "z1", name: "a.example", selected: true, owner: "p1" },
            { id: "z2", name: "b.example", selected: false, owner: "p2" },
            { id: "z3", name: "c.example", selected: false, owner: null },
        ];
        expect(usedZones({ id: "p1", zones }).map((z) => z.name)).toEqual(["a.example"]);
    });
});

describe("connectionDetails", () => {
    it("names the zone mode of a Cloudflare token", () => {
        expect(connectionDetails(cloudflare)).toEqual([{ label: "Zone Mode", value: "Selected zones" }]);
    });

    it("names the URL of an AdGuard Home instance", () => {
        expect(connectionDetails(adguard)).toEqual([{ label: "URL", value: "http://adguard.lan" }]);
    });

    it("lists the servers of a Samba AD domain, in the singular for one", () => {
        expect(connectionDetails(samba)).toEqual([
            { label: "Servers", value: "dc1.ad.example.com, dc2.ad.example.com" },
        ]);
        expect(connectionDetails({ ...samba, servers: ["dc1.ad.example.com"] })[0].label).toBe("Server");
    });

    it("shows a dash where nothing is set", () => {
        expect(connectionDetails({ ...samba, servers: [] })[0].value).toBe("–");
    });
});

describe("accessDetails", () => {
    it("has nothing beside a Cloudflare token", () => {
        expect(accessDetails(cloudflare)).toEqual([]);
    });

    it("names the user and whether a self-signed certificate is accepted", () => {
        expect(accessDetails(adguard)).toEqual([
            { label: "Username", value: "admin" },
            { label: "Self-Signed Certificate", value: "Refused" },
        ]);
        expect(accessDetails(samba)[1].value).toBe("Accepted");
    });
});
