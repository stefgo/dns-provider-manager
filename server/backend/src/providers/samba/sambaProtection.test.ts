import { describe, expect, it } from "vitest";
import { isDomainNode, isSkippedZone } from "./sambaProtection.js";

describe("isDomainNode", () => {
    it("is the zone itself, a service name and the partitions", () => {
        for (const node of ["@", "_ldap._tcp", "_kerberos._udp.Default-First-Site-Name._sites", "DomainDnsZones", "ForestDnsZones", "_ldap._tcp.ForestDnsZones", "gc"]) {
            expect(isDomainNode("sadm.test", node), node).toBe(true);
        }
    });

    it("is every name of _msdcs", () => {
        expect(isDomainNode("_msdcs.sadm.test", "8f3c…")).toBe(true);
    });

    it("is not a host of the operator's", () => {
        expect(isDomainNode("sadm.test", "nas")).toBe(false);
        expect(isDomainNode("sadm.test", "gc.lab")).toBe(false);
        expect(isDomainNode("sadm.test", "app.web")).toBe(false);
    });
});

describe("isSkippedZone", () => {
    it("skips the root hints, the trust anchors, _msdcs and the reverse zones", () => {
        for (const zone of ["RootDNSServers", "..TrustAnchors", "_msdcs.sadm.test", "1.168.192.in-addr.arpa", "8.b.d.0.1.0.0.2.ip6.arpa"]) {
            expect(isSkippedZone(zone), zone).toBe(true);
        }
        expect(isSkippedZone("sadm.test")).toBe(false);
    });
});
