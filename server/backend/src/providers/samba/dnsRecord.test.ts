import { describe, expect, it } from "vitest";
import { decodeDnsRecord, formatIpv6 } from "./dnsRecord.js";

// Read off the zone sadm.test on a Samba 4.22 domain controller, with `ldbsearch` -- the same
// values samba-ad-manager's decoder is tested with.
const RECORDS = {
    a: "BAABAAXwAAAXAAAAAAADhAAAAAAAAAAAwAACCg==",
    aaaa: "EAAcAAXwAAAZAAAAAAADhAAAAAAAAAAAIAENuAAAAAAAAAAAAAAAEA==",
    cname: "EgAFAAXwAAAaAAAAAAADhAAAAAAAAAAAEAMEZngtYQRzYWRtBHRlc3QA",
    txt: "GgAQAAXwAAAcAAAAAAADhAAAAAAAAAAAC3Y9c3BmMSAtYWxsDXNlY29uZCBzdHJpbmc=",
    dynamic: "BAABAAXwAAAfAAAAAAABLAAAAAA18zgAwAACFA==",
    tombstone: "CAAAAAUAAAAgAAAAAAAAAAAAAAAAAAAATkF7eoNZ3QE=",
} as const;

const decode = (name: keyof typeof RECORDS) => decodeDnsRecord(new Uint8Array(Buffer.from(RECORDS[name], "base64")));

describe("decodeDnsRecord", () => {
    it("reads the three types dpm manages, with their TTL", () => {
        expect(decode("a")).toEqual({ ttl: 900, timestamp: 0, data: { type: "A", address: "192.0.2.10" } });
        expect(decode("aaaa")?.data).toEqual({ type: "AAAA", address: "2001:db8::10" });
        expect(decode("cname")?.data).toEqual({ type: "CNAME", target: "fx-a.sadm.test" });
    });

    it("tells a record a client registered by its time stamp", () => {
        const dynamic = decode("dynamic");
        expect(dynamic?.data).toEqual({ type: "A", address: "192.0.2.20" });
        expect(dynamic?.ttl).toBe(300);
        expect(dynamic?.timestamp).toBeGreaterThan(0);
    });

    it("reads every other type as other, and a deleted name as a tombstone", () => {
        expect(decode("txt")?.data).toEqual({ type: "other", typeCode: 16 });
        expect(decode("tombstone")?.data).toEqual({ type: "tombstone" });
    });

    it("refuses what is not a record", () => {
        expect(decodeDnsRecord(new Uint8Array(10))).toBeNull();
        const wrongLength = new Uint8Array(Buffer.from(RECORDS.a, "base64"));
        wrongLength[0] = 9;
        expect(decodeDnsRecord(wrongLength)).toBeNull();
    });
});

describe("formatIpv6", () => {
    it("writes an address as RFC 5952 does", () => {
        const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
        expect(formatIpv6(bytes("20010db8000000000000000000000001"))).toBe("2001:db8::1");
        expect(formatIpv6(bytes("20010db8000000010000000100000001"))).toBe("2001:db8:0:1:0:1:0:1");
        expect(formatIpv6(bytes("00000000000000000000000000000000"))).toBe("::");
    });
});
