import { StatusReportSchema, type DnsRecord, type PendingRemoval, type Provider, type Site } from "@dpm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const records = vi.fn<() => DnsRecord[]>();
const providers = vi.fn<() => Provider[]>();
const sites = vi.fn<() => Site[]>();
const removals = vi.fn<() => PendingRemoval[]>();

// The repositories and SyncService reach the database and config.yaml when they are imported.
vi.mock("../repositories/RecordRepository.js", () => ({ RecordRepository: { findAll: () => [] } }));
vi.mock("../repositories/ProviderRepository.js", () => ({ ProviderRepository: { findAll: () => providers() } }));
vi.mock("../repositories/SiteRepository.js", () => ({ SiteRepository: { findAll: () => sites() } }));
vi.mock("./SyncService.js", () => ({ SyncService: { views: () => records(), removals: () => removals() } }));

const { StatusService } = await import("./StatusService.js");

const NOW = Date.parse("2026-10-27T10:00:00.000Z");

const provider = (id: string, over: Partial<Provider> = {}): Provider =>
    ({
        type: "adguard",
        id,
        name: `AdGuard ${id}`,
        siteIds: ["internal"],
        lastSeenAt: "2026-10-27T09:00:00.000Z",
        lastError: null,
        readable: true,
        ...over,
    }) as Provider;

const record = (id: string, status: DnsRecord["links"][number]["status"]): DnsRecord =>
    ({
        id,
        name: `${id}.example.com`,
        type: "A",
        value: "10.0.0.1",
        siteIds: ["internal"],
        links: [{ providerId: "a", status, error: null, observed: null, syncedAt: null }],
        skipped: [],
    }) as unknown as DnsRecord;

const site = (id: string): Site => ({ id, name: id, providerIds: ["a"], recordCount: 1 }) as Site;

beforeEach(() => {
    records.mockReset().mockReturnValue([]);
    providers.mockReset().mockReturnValue([]);
    sites.mockReset().mockReturnValue([]);
    removals.mockReset().mockReturnValue([]);
});

describe("StatusService.report", () => {
    it("is unknown until a provider has been read", () => {
        providers.mockReturnValue([provider("a", { lastSeenAt: null })]);
        const report = StatusService.report(NOW);
        expect(StatusReportSchema.parse(report)).toEqual(report);
        expect(report).toMatchObject({ app: "dpm", status: "unknown",checkedAt: "2026-10-27T10:00:00.000Z" });
        expect(report.findings.map((f) => f.type)).toEqual(["provider-not-read"]);
    });

    it("is healthy with every record in sync", () => {
        providers.mockReturnValue([provider("a")]);
        sites.mockReturnValue([site("internal")]);
        records.mockReturnValue([record("www", "in_sync")]);

        const report = StatusService.report(NOW);

        expect(report.status).toBe("healthy");
        expect(report.summary).toEqual({
            providers: { total: 1, reachable: 1, unreachable: 0, notRead: 0 },
            records: { total: 1 },
        });
    });

    it("lists the dashboard's lines, errors first", () => {
        providers.mockReturnValue([provider("a"), provider("b", { lastError: "connection refused" })]);
        sites.mockReturnValue([site("internal")]);
        records.mockReturnValue([record("www", "drift")]);

        const report = StatusService.report(NOW);

        expect(report.status).toBe("critical");
        expect(report.counts).toEqual({ error: 1, warning: 1 });
        expect(report.findings).toEqual([
            {
                id: "provider-unreachable:b",
                type: "provider-unreachable",
                severity: "error",
                text: "AdGuard b is not reachable: connection refused",
                since: null,
            },
            { id: "record-drift:www:a", type: "record-drift", severity: "warning", text: "www.example.com A 10.0.0.1 changed at AdGuard a", since: null },
        ]);
    });
});
