import { describe, expect, it } from "vitest";
import { entriesFromNode, nodeFqdn, sambaZoneId } from "./sambaMapping.js";
import { ldapsUrl } from "./SambaClient.js";

// The values the decoder is tested with: A 192.0.2.10 (TTL 900), AAAA 2001:db8::10, CNAME fx-a.sadm.test, a TXT.
const value = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
const A = value("BAABAAXwAAAXAAAAAAADhAAAAAAAAAAAwAACCg==");
const AAAA = value("EAAcAAXwAAAZAAAAAAADhAAAAAAAAAAAIAENuAAAAAAAAAAAAAAAEA==");
const CNAME = value("EgAFAAXwAAAaAAAAAAADhAAAAAAAAAAAEAMEZngtYQRzYWRtBHRlc3QA");
const TXT = value("GgAQAAXwAAAcAAAAAAADhAAAAAAAAAAAC3Y9c3BmMSAtYWxsDXNlY29uZCBzdHJpbmc=");

const zone = { id: sambaZoneId("SADM.test"), name: "sadm.test" };
const none = new Set<string>();

describe("nodeFqdn", () => {
    it("is the zone for @ and the name below it otherwise", () => {
        expect(nodeFqdn("@", "sadm.test")).toBe("sadm.test");
        expect(nodeFqdn("NAS", "sadm.test")).toBe("nas.sadm.test");
        expect(nodeFqdn("app.web", "sadm.test")).toBe("app.web.sadm.test");
    });
});

describe("entriesFromNode", () => {
    it("reads the A, AAAA and CNAME records of a name, and nothing else", () => {
        const entries = entriesFromNode(zone, "nas", [A, AAAA, CNAME, TXT], none);
        expect(entries.map((e) => [e.type, e.value, e.ttl])).toEqual([
            ["A", "192.0.2.10", 900],
            ["AAAA", "2001:db8::10", 900],
            ["CNAME", "fx-a.sadm.test", 900],
        ]);
        expect(entries[0]).toMatchObject({ externalId: "A nas.sadm.test 192.0.2.10", zoneId: "ad:sadm.test", zone: "sadm.test" });
    });

    it("gives nothing for a name of the domain's own", () => {
        expect(entriesFromNode(zone, "@", [A], none)).toEqual([]);
        expect(entriesFromNode(zone, "_ldap._tcp", [CNAME], none)).toEqual([]);
        expect(entriesFromNode(zone, "DomainDnsZones", [A], none)).toEqual([]);
    });

    it("leaves out the addresses under a domain controller's name, not an alias there", () => {
        const dcs = new Set(["dc1.sadm.test"]);
        expect(entriesFromNode(zone, "dc1", [A, AAAA, CNAME], dcs).map((e) => e.type)).toEqual(["CNAME"]);
    });

    it("skips a value that does not decode", () => {
        expect(entriesFromNode(zone, "nas", [new Uint8Array(3), A], none)).toHaveLength(1);
    });
});

describe("ldapsUrl", () => {
    it("adds port 636 where none is named", () => {
        expect(ldapsUrl("dc1.sadm.test")).toBe("ldaps://dc1.sadm.test:636");
        expect(ldapsUrl("dc1.sadm.test:3269")).toBe("ldaps://dc1.sadm.test:3269");
        expect(ldapsUrl("10.0.0.5")).toBe("ldaps://10.0.0.5:636");
        expect(ldapsUrl("[2001:db8::5]")).toBe("ldaps://[2001:db8::5]:636");
        expect(ldapsUrl("[2001:db8::5]:636")).toBe("ldaps://[2001:db8::5]:636");
    });
});
