import type { DnsRecord, PendingRemoval, Provider, RecordLinkView, Site } from "@dpm/shared";

/** The shapes the dashboard's tests build, each with what it does not care about filled in. */

export const link = (over: Partial<RecordLinkView> = {}): RecordLinkView => ({
    providerId: "a",
    status: "in_sync",
    error: null,
    observed: null,
    syncedAt: "2026-10-26T10:00:00.000Z",
    ...over,
});

export const record = (id: string, over: Partial<DnsRecord> = {}): DnsRecord => ({
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

export const provider = (id: string, over: Partial<Extract<Provider, { type: "adguard" }>> = {}): Provider => ({
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

export const site = (id: string, over: Partial<Site> = {}): Site => ({
    id,
    name: id,
    description: "",
    providerIds: ["a"],
    recordCount: 1,
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: null,
    ...over,
});

export const removal = (over: Partial<PendingRemoval> = {}): PendingRemoval => ({
    providerId: "a",
    name: "old.example.com",
    type: "A",
    value: "10.0.0.9",
    error: null,
    ...over,
});
