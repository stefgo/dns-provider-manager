import { describe, expect, it } from "vitest";
import { buildFindings, dnsStatus, providerCount } from "./dnsFindings.js";
import type { DnsRecord, PendingRemoval, Provider, RecordLinkView, Site } from "./types.js";

// The shapes these tests build, each with what it does not care about filled in -- as the
// dashboard's tests build them (server/frontend/src/features/dashboard/lib/testFixtures.ts),
// which also check every finding's text through the dashboard's own `buildFindings`.
const link = (over: Partial<RecordLinkView> = {}): RecordLinkView => ({
    providerId: "a",
    status: "in_sync",
    error: null,
    observed: null,
    syncedAt: "2026-10-26T10:00:00.000Z",
    ...over,
});

const record = (id: string, over: Partial<DnsRecord> = {}): DnsRecord => ({
    id,
    name: `${id}.example.com`,
    type: "A",
    value: "10.0.0.1",
    settings: [],
    note: "",
    siteIds: ["internal"],
    createdAt: "2026-10-26T10:00:00.000Z",
    createdBy: null,
    updatedAt: null,
    updatedBy: null,
    links: [link()],
    skipped: [],
    ...over,
});

const provider = (id: string, over: Partial<Extract<Provider, { type: "adguard" }>> = {}): Provider => ({
    type: "adguard",
    id,
    name: `AdGuard ${id}`,
    autoCorrect: false,
    readOnly: false,
    writable: true,
    hasSecret: true,
    siteIds: ["internal"],
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: null,
    lastSeenAt: "2026-10-26T10:00:00.000Z",
    lastError: null,
    zones: [],
    readable: true,
    url: `http://${id}.lan`,
    username: "admin",
    allowSelfSigned: false,
    ...over,
});

const site = (id: string, over: Partial<Site> = {}): Site => ({
    id,
    name: id,
    description: "",
    providerIds: ["a"],
    recordCount: 1,
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: null,
    ...over,
});

const removal = (over: Partial<PendingRemoval> = {}): PendingRemoval => ({
    providerId: "a",
    name: "old.example.com",
    type: "A",
    value: "10.0.0.9",
    error: null,
    ...over,
});

describe("buildFindings", () => {
    it("names where each finding can be dealt with, without a path of the dashboard", () => {
        const findings = buildFindings({
            records: [record("w", { links: [link({ status: "error", error: "timeout" })] })],
            providers: [provider("a"), provider("b", { lastSeenAt: null })],
            sites: [site("lab", { providerIds: [], recordCount: 2 })],
            removals: [removal({ error: "refused" })],
        });
        expect(findings.map((f) => [f.type, f.target])).toEqual([
            ["record-write-failed", { kind: "record", id: "w" }],
            ["removal-failed", { kind: "records" }],
            ["provider-not-read", { kind: "provider", id: "b" }],
            ["site-without-provider", { kind: "site", id: "lab" }],
        ]);
    });

    it("takes more than a handful of one kind at one provider into one line that leads to the problems", () => {
        const records = Array.from({ length: 6 }, (_, i) => record(`r${i}`, { links: [link({ status: "missing" })] }));
        const findings = buildFindings({ records, providers: [provider("a")], sites: [site("internal")], removals: [] });
        expect(findings).toEqual([
            {
                id: "record-missing:a:group",
                type: "record-missing",
                severity: "warning",
                text: "6 records were deleted at AdGuard a",
                target: { kind: "records-problems" },
            },
        ]);
    });
});

describe("dnsStatus", () => {
    it("is unknown until a provider has been read, then follows the worst finding", () => {
        expect(dnsStatus([], [provider("a", { lastSeenAt: null })])).toBe("unknown");
        expect(dnsStatus([], [provider("a")])).toBe("healthy");
        expect(dnsStatus([{ severity: "warning" }], [provider("a")])).toBe("degraded");
        expect(dnsStatus([{ severity: "warning" }, { severity: "error" }], [provider("a")])).toBe("critical");
    });
});

describe("providerCount", () => {
    it("counts reachable, unreachable and not yet read providers", () => {
        expect(
            providerCount([provider("a"), provider("b", { lastError: "refused" }), provider("c", { lastSeenAt: null })]),
        ).toEqual({ total: 3, reachable: 1, unreachable: 1, notRead: 1 });
    });
});
