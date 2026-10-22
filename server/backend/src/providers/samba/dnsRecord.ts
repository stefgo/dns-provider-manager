/**
 * One value of `dnsRecord`: one record of a name, as an Active Directory keeps it on a
 * `dnsNode`. Taken over from samba-ad-manager, which reads and writes the same attribute;
 * what is here is the reading of the three types dpm manages.
 *
 * The layout is `dnsp_DnssrvRpcRecord` (Samba's `dnsp.idl`, after MS-DNSP 2.3.2.2): a fixed
 * head of 24 bytes and the record's data behind it. The head is little-endian -- except the
 * TTL, which is big-endian, as is everything inside the data.
 *
 *     0  uint16  wDataLength    the length of what follows the head
 *     2  uint16  wType          the record type; 0 is a tombstone
 *     4  uint8   version        5
 *     5  uint8   rank           0xF0 for a record of the zone itself
 *     6  uint16  flags          0
 *     8  uint32  dwSerial       the zone's serial number when the record was written
 *    12  uint32  dwTtlSeconds   big-endian
 *    16  uint32  dwReserved
 *    20  uint32  dwTimeStamp    hours since 1601-01-01; 0 for a record that does not age
 *    24  ...     data
 *
 * A host name in the data is a `DNS_COUNT_NAME`: its length in bytes, the number of its
 * labels, each label behind a length byte, and a zero.
 */
export type DecodedData =
    | { type: "A" | "AAAA"; address: string }
    | { type: "CNAME"; target: string }
    | { type: "tombstone" }
    | { type: "other"; typeCode: number };

export interface DecodedDnsRecord {
    ttl: number;
    /** Hours since 1601-01-01; 0 for a record somebody entered, which does not age. */
    timestamp: number;
    data: DecodedData;
}

const HEAD_LENGTH = 24;
const TYPE_A = 1;
const TYPE_CNAME = 5;
const TYPE_AAAA = 28;

/** An IPv6 address the way RFC 5952 writes it: lower case, the longest run of zeros as `::`. */
export function formatIpv6(bytes: Uint8Array): string {
    const groups: number[] = [];
    for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);

    let bestStart = -1;
    let bestLength = 0;
    for (let i = 0; i < 8; i++) {
        if (groups[i] !== 0) continue;
        let end = i;
        while (end < 8 && groups[end] === 0) end++;
        if (end - i > bestLength) {
            bestStart = i;
            bestLength = end - i;
        }
        i = end;
    }
    const hex = (list: number[]) => list.map((group) => group.toString(16)).join(":");
    // A single zero group is written out; only a run of two or more is shortened.
    if (bestLength < 2) return hex(groups);
    return `${hex(groups.slice(0, bestStart))}::${hex(groups.slice(bestStart + bestLength))}`;
}

/** A `DNS_COUNT_NAME` as the name reads: `dc1.sadm.test`. Throws past the end of the data. */
function countName(bytes: Uint8Array): string {
    let offset = 0;
    const take = (length: number) => {
        if (offset + length > bytes.length) throw new RangeError("The record is shorter than it says");
        const at = offset;
        offset += length;
        return at;
    };
    take(1);
    const labels = bytes[take(1)];
    const parts: string[] = [];
    for (let i = 0; i < labels; i++) {
        const length = bytes[take(1)];
        const at = take(length);
        parts.push(Buffer.from(bytes.subarray(at, at + length)).toString("utf8"));
    }
    return parts.join(".");
}

function decodeData(type: number, bytes: Uint8Array): DecodedData {
    switch (type) {
        case 0:
            return { type: "tombstone" };
        case TYPE_A:
            if (bytes.length === 4) return { type: "A", address: [...bytes].join(".") };
            break;
        case TYPE_AAAA:
            if (bytes.length === 16) return { type: "AAAA", address: formatIpv6(bytes) };
            break;
        case TYPE_CNAME:
            try {
                return { type: "CNAME", target: countName(bytes) };
            } catch {
                break;
            }
    }
    return { type: "other", typeCode: type };
}

/**
 * Reads one value. Null for what is not a record in the layout this knows: too short, a
 * length that does not fit, another version.
 */
export function decodeDnsRecord(bytes: Uint8Array): DecodedDnsRecord | null {
    if (bytes.length < HEAD_LENGTH) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, true) !== bytes.length - HEAD_LENGTH) return null;
    if (view.getUint8(4) !== 5) return null;
    return {
        ttl: view.getUint32(12, false),
        timestamp: view.getUint32(20, true),
        data: decodeData(view.getUint16(2, true), bytes.subarray(HEAD_LENGTH)),
    };
}
