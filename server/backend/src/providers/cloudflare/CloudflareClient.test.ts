import { describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "./CloudflareClient.js";
import { cloudflareErrors, entryFromCloudflare } from "./cloudflareMapping.js";

/** A fetch that answers each URL from a table, and remembers what it was asked. */
function answering(pages: Record<string, { status?: number; body: unknown }>) {
    const calls: { url: string; auth: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const text = String(url);
        calls.push({ url: text, auth: new Headers(init?.headers).get("authorization") });
        const key = Object.keys(pages).find((k) => text.includes(k));
        if (!key) throw new Error(`unexpected ${text}`);
        const { status = 200, body } = pages[key];
        return new Response(JSON.stringify(body), { status });
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const ok = (result: unknown[], page = 1, total_pages = 1) => ({ success: true, errors: [], result, result_info: { page, total_pages } });

const ZONE = { id: "z1", name: "example.com" };

describe("entryFromCloudflare", () => {
    it("takes A, AAAA and CNAME records over in dpm's terms", () => {
        expect(entryFromCloudflare({ id: "r1", name: "App.Example.com", type: "A", content: "192.168.1.10", ttl: 1, proxied: true }, ZONE)).toEqual({
            externalId: "r1",
            zoneId: "z1",
            zone: "example.com",
            name: "app.example.com",
            type: "A",
            value: "192.168.1.10",
            ttl: null,
            proxied: true,
        });
        expect(entryFromCloudflare({ id: "r2", name: "www.example.com", type: "CNAME", content: "App.Example.com.", ttl: 300 }, ZONE)).toMatchObject({
            value: "app.example.com",
            ttl: 300,
            proxied: false,
        });
        expect(entryFromCloudflare({ id: "r3", name: "v6.example.com", type: "AAAA", content: "2001:DB8::1" }, ZONE)?.value).toBe("2001:db8::1");
    });

    it("leaves every other type out", () => {
        expect(entryFromCloudflare({ id: "r4", name: "example.com", type: "MX", content: "mail.example.com" }, ZONE)).toBeNull();
        expect(entryFromCloudflare({ id: "r5", name: "example.com", type: "TXT", content: "v=spf1 -all" }, ZONE)).toBeNull();
    });
});

describe("cloudflareErrors", () => {
    it("writes Cloudflare's errors as one sentence", () => {
        expect(cloudflareErrors({ errors: [{ code: 10000, message: "Authentication error" }] })).toBe("Authentication error (10000)");
        expect(cloudflareErrors({ errors: [] })).toBeNull();
        expect(cloudflareErrors(null)).toBeNull();
    });
});

describe("CloudflareClient", () => {
    it("sends the token and reads every page of zones", async () => {
        const { fetchImpl, calls } = answering({
            "zones?page=1": { body: ok([{ id: "z1", name: "Example.com" }], 1, 2) },
            "zones?page=2": { body: ok([{ id: "z2", name: "example.net" }], 2, 2) },
        });
        const zones = await new CloudflareClient("tok", fetchImpl).listZones();
        expect(zones).toEqual([
            { id: "z1", name: "example.com" },
            { id: "z2", name: "example.net" },
        ]);
        expect(calls.map((c) => c.auth)).toEqual(["Bearer tok", "Bearer tok"]);
    });

    it("reads the records of a zone and keeps only the types dpm manages", async () => {
        const { fetchImpl } = answering({
            "/zones/z1/dns_records": {
                body: ok([
                    { id: "r1", name: "app.example.com", type: "A", content: "192.168.1.10", ttl: 1 },
                    { id: "r2", name: "example.com", type: "MX", content: "mail.example.com" },
                ]),
            },
        });
        const entries = await new CloudflareClient("tok", fetchImpl).listRecords({ id: "z1", name: "example.com" });
        expect(entries.map((e) => e.externalId)).toEqual(["r1"]);
    });

    it("says that the token was refused, with Cloudflare's reason", async () => {
        const { fetchImpl } = answering({
            zones: { status: 403, body: { success: false, errors: [{ code: 9109, message: "Invalid access token" }] } },
        });
        await expect(new CloudflareClient("bad", fetchImpl).listZones()).rejects.toThrow(
            "Cloudflare refused the API token: Invalid access token (9109)",
        );
    });

    it("says when Cloudflare cannot be reached", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError("fetch failed");
        }) as unknown as typeof fetch;
        await expect(new CloudflareClient("tok", fetchImpl).listZones()).rejects.toThrow("Cloudflare could not be reached: fetch failed");
    });
});
