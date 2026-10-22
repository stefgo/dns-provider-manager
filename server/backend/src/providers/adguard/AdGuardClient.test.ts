import { describe, expect, it, vi } from "vitest";
import { AdGuardClient } from "./AdGuardClient.js";
import { entryFromRewrite, rewriteId, rewriteOf, versionError } from "./adguardMapping.js";
import type { HttpOptions } from "../http.js";

describe("entryFromRewrite", () => {
    it("takes the type from the answer", () => {
        expect(entryFromRewrite({ domain: "NAS.lan.", answer: "192.168.1.20" })).toEqual({
            externalId: '["NAS.lan.","192.168.1.20"]',
            zoneId: null,
            zone: null,
            name: "nas.lan",
            type: "A",
            value: "192.168.1.20",
            ttl: null,
            proxied: false,
            disabled: false,
        });
        expect(entryFromRewrite({ domain: "v6.lan", answer: "2001:DB8::1" })).toMatchObject({ type: "AAAA", value: "2001:db8::1" });
        expect(entryFromRewrite({ domain: "*.lab.lan", answer: "Host.lan." })).toMatchObject({ name: "*.lab.lan", type: "CNAME", value: "host.lan" });
    });

    it("marks a disabled rewrite, and leaves out one that only passes a type upstream", () => {
        expect(entryFromRewrite({ domain: "a.lan", answer: "192.168.1.1", enabled: false })).toMatchObject({ disabled: true });
        expect(entryFromRewrite({ domain: "a.lan", answer: "A" })).toBeNull();
        expect(entryFromRewrite({ domain: "a.lan", answer: "AAAA" })).toBeNull();
    });
});

describe("rewriteId", () => {
    it("keeps domain and answer exactly, a space or a trailing dot included", () => {
        const id = rewriteId({ domain: "bad name.lan.", answer: "10.0.0.1" });
        expect(rewriteOf(id)).toEqual({ domain: "bad name.lan.", answer: "10.0.0.1" });
        expect(rewriteOf("nas.lan 10.0.0.1")).toBeNull();
    });
});

describe("versionError", () => {
    it("refuses a version without rewrite/update, and lets an unreadable one through", () => {
        expect(versionError("v0.107.32")).toBe("AdGuard Home v0.107.32 is too old: dpm needs v0.107.33 or later");
        expect(versionError("v0.107.33")).toBeNull();
        expect(versionError("v0.108.0-b.1")).toBeNull();
        expect(versionError("dev")).toBeNull();
    });
});

describe("AdGuardClient", () => {
    const options = { url: "http://10.0.0.2:3000/", username: "admin", password: "pw", allowSelfSigned: true };
    const answering = (answers: Record<string, { status?: number; body: unknown }>) =>
        vi.fn(async (url: string, _options: HttpOptions) => {
            const key = Object.keys(answers).find((k) => url.endsWith(k));
            if (!key) throw new Error(`unexpected ${url}`);
            const { status = 200, body } = answers[key];
            return { status, body: typeof body === "string" ? body : JSON.stringify(body) };
        });

    it("reads the rewrites with Basic Auth, and passes the certificate setting on", async () => {
        const request = answering({ "/control/rewrite/list": { body: [{ domain: "nas.lan", answer: "192.168.1.20" }, { domain: "x", answer: "A" }] } });
        const entries = await new AdGuardClient(options, request).listRecords();
        expect(entries.map((e) => e.name)).toEqual(["nas.lan"]);
        const [url, sent] = request.mock.calls[0];
        expect(url).toBe("http://10.0.0.2:3000/control/rewrite/list");
        expect(sent.headers?.Authorization).toBe(`Basic ${Buffer.from("admin:pw").toString("base64")}`);
        expect(sent.insecure).toBe(true);
    });

    it("says what it found when tested, and that its rewrites are switched off", async () => {
        const request = answering({
            "/control/status": { body: { version: "v0.107.79" } },
            "/control/rewrite/list": { body: [{ domain: "nas.lan", answer: "192.168.1.20" }] },
            "/control/rewrite/settings": { body: { enabled: false } },
        });
        expect(await new AdGuardClient(options, request).test()).toBe(
            "AdGuard Home v0.107.79 answered and holds 1 DNS rewrite. Its rewrites are switched off as a whole in its settings, so none of them is answered.",
        );
    });

    it("fails the test of a version it cannot write to", async () => {
        const request = answering({ "/control/status": { body: { version: "v0.107.20" } } });
        await expect(new AdGuardClient(options, request).test()).rejects.toThrow(/too old/);
    });

    it("adds, changes and removes a rewrite by its domain and answer as AdGuard Home keeps them", async () => {
        const request = answering({
            "/control/rewrite/add": { body: "OK" },
            "/control/rewrite/update": { body: "OK" },
            "/control/rewrite/delete": { body: "OK" },
        });
        const client = new AdGuardClient(options, request);
        const record = { name: "nas.lan", type: "A" as const, value: "192.168.1.20", ttl: 300, proxied: false };
        const created = await client.create(null, record);
        expect(created).toMatchObject({ externalId: '["nas.lan","192.168.1.20"]', ttl: null });
        const target = { externalId: rewriteId({ domain: "NAS.lan.", answer: "192.168.1.20" }), zoneId: null, zone: null };
        await client.update(target, { ...record, value: "192.168.1.21" });
        await client.delete(target);
        expect(request.mock.calls.map(([url, sent]) => [url.replace(options.url, "/"), sent.method, sent.body])).toEqual([
            ["/control/rewrite/add", "POST", { domain: "nas.lan", answer: "192.168.1.20", enabled: true }],
            [
                "/control/rewrite/update",
                "PUT",
                { target: { domain: "NAS.lan.", answer: "192.168.1.20" }, update: { domain: "nas.lan", answer: "192.168.1.21", enabled: true } },
            ],
            ["/control/rewrite/delete", "POST", { domain: "NAS.lan.", answer: "192.168.1.20" }],
        ]);
    });

    it("passes AdGuard Home's reason on", async () => {
        const request = answering({ "/control/rewrite/update": { status: 400, body: "target rule not found\n" } });
        const target = { externalId: rewriteId({ domain: "a.lan", answer: "10.0.0.1" }), zoneId: null, zone: null };
        await expect(
            new AdGuardClient(options, request).update(target, { name: "a.lan", type: "A", value: "10.0.0.2", ttl: null, proxied: false }),
        ).rejects.toThrow("AdGuard Home refused it (HTTP 400): target rule not found");
    });

    it("says that the password was refused, and that the address is not AdGuard Home's", async () => {
        await expect(new AdGuardClient(options, answering({ "/control/rewrite/list": { status: 401, body: "" } })).listRecords()).rejects.toThrow(
            /^AdGuard Home refused the user name or the password/,
        );
        await expect(new AdGuardClient(options, answering({ "/control/rewrite/list": { status: 404, body: "" } })).listRecords()).rejects.toThrow(
            /is http:\/\/10.0.0.2:3000 the address of its web interface/,
        );
    });
});
