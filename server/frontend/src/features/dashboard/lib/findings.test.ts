import { describe, expect, it } from "vitest";
import { GROUP_ABOVE, buildFindings, dnsStatus, findingSummary, type FindingsInput } from "./findings";
import { link, provider, record, removal, site } from "./testFixtures";

const input = (over: Partial<FindingsInput> = {}): FindingsInput => ({
    records: [],
    providers: [provider("a")],
    sites: [site("internal")],
    removals: [],
    ...over,
});

const observed = { name: "x", value: "10.0.0.9", ttl: null, proxied: false, disabled: false };

describe("buildFindings", () => {
    it("finds nothing where every record is in sync", () => {
        expect(buildFindings(input({ records: [record("r1")] }))).toEqual([]);
    });

    it("says what failed, what changed and what was deleted at a provider, each leading to its record", () => {
        const records = [
            record("w", { links: [link({ status: "error", error: "403 Forbidden" })] }),
            record("d", { links: [link({ status: "drift", observed })] }),
            record("m", { links: [link({ status: "missing" })] }),
            record("rm", { links: [link({ status: "removing", error: "timeout" })] }),
        ];
        expect(buildFindings(input({ records })).map(({ type, severity, text, to }) => ({ type, severity, text, to }))).toEqual([
            {
                type: "record-write-failed",
                severity: "error",
                text: "w.example.com A 10.0.0.1 could not be written to AdGuard a: 403 Forbidden",
                to: "/records/w",
            },
            {
                type: "removal-failed",
                severity: "error",
                text: "rm.example.com A 10.0.0.1 could not be removed from AdGuard a: timeout",
                to: "/records/rm",
            },
            { type: "record-missing", severity: "warning", text: "m.example.com A 10.0.0.1 was deleted at AdGuard a", to: "/records/m" },
            {
                type: "record-drift",
                severity: "warning",
                text: "d.example.com A 10.0.0.1 changed at AdGuard a: Holds 10.0.0.9 instead",
                to: "/records/d",
            },
        ]);
    });

    it("does not count what waits or is held back on purpose", () => {
        const records = [
            record("p", { links: [link({ status: "pending", error: "Read only" })] }),
            record("r", { links: [link({ status: "removing" })] }),
            record("parked", { siteIds: [], links: [] }),
        ];
        expect(buildFindings(input({ records }))).toEqual([]);
    });

    it("takes the failed writes at a provider that cannot be reached into the provider's finding", () => {
        const records = [
            record("w", { links: [link({ status: "error", error: "ECONNREFUSED" })] }),
            record("p", { links: [link({ status: "pending" })] }),
            record("d", { links: [link({ status: "drift", observed })] }),
        ];
        const providers = [provider("a", { lastError: "ECONNREFUSED", lastSeenAt: "2026-10-26T09:00:00.000Z" })];
        const removals = [removal({ error: "ECONNREFUSED" })];
        const found = buildFindings(input({ records, providers, removals }));
        expect(found.map((f) => f.type)).toEqual(["provider-unreachable", "record-drift"]);
        expect(found[0]).toMatchObject({
            text: "AdGuard a is not reachable: ECONNREFUSED · 3 records wait for it",
            to: "/providers/a",
            lastReached: "2026-10-26T09:00:00.000Z",
        });
    });

    it(`takes more than ${GROUP_ABOVE} findings of one kind at one provider together`, () => {
        const drifted = Array.from({ length: GROUP_ABOVE + 1 }, (_, i) => record(`d${i}`, { links: [link({ status: "drift", observed })] }));
        const elsewhere = record("b", { links: [link({ providerId: "b", status: "drift", observed })] });
        const found = buildFindings(input({ records: [...drifted, elsewhere], providers: [provider("a"), provider("b")] }));
        expect(found.map(({ text, to }) => ({ text, to }))).toEqual([
            { text: "6 records changed at AdGuard a", to: { pathname: "/records", search: "?status=problems" } },
            { text: "b.example.com A 10.0.0.1 changed at AdGuard b: Holds 10.0.0.9 instead", to: "/records/b" },
        ]);
    });

    it("names deleted records a provider still holds and could not be removed from", () => {
        const found = buildFindings(input({ removals: [removal({ error: "500" }), removal({ name: "fine.example.com" })] }));
        expect(found).toEqual([
            expect.objectContaining({
                type: "removal-failed",
                text: "Deleted record old.example.com A 10.0.0.9 could not be removed from AdGuard a: 500",
                to: "/records",
            }),
        ]);
    });

    it("names a provider that has never been read, but not one this build cannot read", () => {
        const providers = [
            provider("a"),
            provider("n", { lastSeenAt: null }),
            provider("x", { lastSeenAt: null, readable: false }),
        ];
        expect(buildFindings(input({ providers })).map((f) => f.text)).toEqual(["AdGuard n has not been read yet"]);
    });

    it("names a site with records and no provider, and leaves its records to it", () => {
        const sites = [site("lab", { providerIds: [], recordCount: 2 }), site("empty", { providerIds: [], recordCount: 0 })];
        const records = [record("r", { siteIds: ["lab"], links: [] })];
        expect(buildFindings(input({ sites, records })).map(({ text, to }) => ({ text, to }))).toEqual([
            { text: "Site lab has no provider to write its 2 records to", to: "/sites/lab" },
        ]);
    });

    it("names a record none of whose site's providers takes it, with the reason", () => {
        const records = [record("r", { links: [], skipped: [{ providerId: "a", reason: "Outside its zones" }] })];
        expect(buildFindings(input({ records })).map((f) => f.text)).toEqual([
            "r.example.com A 10.0.0.1 goes to no provider of its sites: Outside its zones",
        ]);
    });

    it("lists errors first, then providers before records before sites", () => {
        const found = buildFindings(
            input({
                providers: [provider("a"), provider("n", { lastSeenAt: null })],
                sites: [site("internal"), site("lab", { providerIds: [] })],
                records: [
                    record("d", { links: [link({ status: "drift", observed })] }),
                    record("w", { links: [link({ status: "error" })] }),
                ],
            }),
        );
        expect(found.map((f) => f.type)).toEqual(["record-write-failed", "provider-not-read", "record-drift", "site-without-provider"]);
    });
});

describe("dnsStatus", () => {
    const warning = { id: "w", type: "record-drift", severity: "warning", text: "" } as const;
    const error = { ...warning, id: "e", severity: "error" } as const;

    it("is unknown until some provider has been read", () => {
        expect(dnsStatus([], [])).toBe("unknown");
        expect(dnsStatus([warning], [{ lastSeenAt: null, lastError: null }])).toBe("unknown");
    });

    it("follows the worst finding", () => {
        const read = [{ lastSeenAt: "2026-10-26T10:00:00.000Z", lastError: null }];
        expect(dnsStatus([], read)).toBe("healthy");
        expect(dnsStatus([warning], read)).toBe("degraded");
        expect(dnsStatus([warning, error], read)).toBe("critical");
    });

    it("takes a reading that failed as a reading", () => {
        expect(dnsStatus([error], [{ lastSeenAt: null, lastError: "down" }])).toBe("critical");
    });
});

describe("findingSummary", () => {
    it("counts the findings, or says what the status means", () => {
        expect(findingSummary([{ id: "w", type: "record-drift", severity: "warning", text: "" }], "degraded", 1)).toBe("1 finding");
        expect(findingSummary([], "healthy", 1)).toBe("Nothing needs attention.");
        expect(findingSummary([], "unknown", 0)).toBe("No provider yet");
    });
});
