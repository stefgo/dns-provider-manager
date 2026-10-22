import { describe, expect, it, vi } from "vitest";
import { AdGuardClient } from "./AdGuardClient.js";
import { entryFromRewrite } from "./adguardMapping.js";

describe("entryFromRewrite", () => {
    it("takes the type from the answer", () => {
        expect(entryFromRewrite({ domain: "NAS.lan.", answer: "192.168.1.20" })).toEqual({
            externalId: "NAS.lan. 192.168.1.20",
            zoneId: null,
            zone: null,
            name: "nas.lan",
            type: "A",
            value: "192.168.1.20",
            ttl: null,
            proxied: false,
        });
        expect(entryFromRewrite({ domain: "v6.lan", answer: "2001:DB8::1" })).toMatchObject({ type: "AAAA", value: "2001:db8::1" });
        expect(entryFromRewrite({ domain: "*.lab.lan", answer: "Host.lan." })).toMatchObject({ name: "*.lab.lan", type: "CNAME", value: "host.lan" });
    });

    it("leaves out a disabled rewrite and one that only passes a type upstream", () => {
        expect(entryFromRewrite({ domain: "a.lan", answer: "192.168.1.1", enabled: false })).toBeNull();
        expect(entryFromRewrite({ domain: "a.lan", answer: "A" })).toBeNull();
        expect(entryFromRewrite({ domain: "a.lan", answer: "AAAA" })).toBeNull();
    });
});

describe("AdGuardClient", () => {
    const options = { url: "http://10.0.0.2:3000/", username: "admin", password: "pw", allowSelfSigned: true };
    const answering = (answers: Record<string, { status?: number; body: unknown }>) =>
        vi.fn(async (url: string) => {
            const key = Object.keys(answers).find((k) => url.endsWith(k));
            if (!key) throw new Error(`unexpected ${url}`);
            return { status: answers[key].status ?? 200, body: JSON.stringify(answers[key].body) };
        });

    it("reads the rewrites with Basic Auth, and passes the certificate setting on", async () => {
        const get = answering({ "/control/rewrite/list": { body: [{ domain: "nas.lan", answer: "192.168.1.20" }, { domain: "x", answer: "A" }] } });
        const entries = await new AdGuardClient(options, get).listRecords();
        expect(entries.map((e) => e.name)).toEqual(["nas.lan"]);
        const [url, sent] = get.mock.calls[0] as unknown as [string, { headers: Record<string, string>; insecure: boolean }];
        expect(url).toBe("http://10.0.0.2:3000/control/rewrite/list");
        expect(sent.headers.Authorization).toBe(`Basic ${Buffer.from("admin:pw").toString("base64")}`);
        expect(sent.insecure).toBe(true);
    });

    it("says what it found when tested", async () => {
        const get = answering({
            "/control/status": { body: { version: "v0.107.70" } },
            "/control/rewrite/list": { body: [{ domain: "nas.lan", answer: "192.168.1.20" }] },
        });
        expect(await new AdGuardClient(options, get).test()).toBe("AdGuard Home v0.107.70 answered and holds 1 DNS rewrite.");
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
