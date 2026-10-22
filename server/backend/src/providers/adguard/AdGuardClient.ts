import type { DnsProviderClient, ProviderEntry } from "../DnsProvider.js";
import { httpGet, type HttpOptions } from "../http.js";
import { entryFromRewrite, type AdGuardRewrite } from "./adguardMapping.js";

/** How long one call may take before it counts as unanswered. */
const TIMEOUT_MS = 10_000;

type Get = (url: string, options: HttpOptions) => ReturnType<typeof httpGet>;

/**
 * One AdGuard Home instance, through the API of its web interface with Basic Auth. Reads the
 * DNS rewrites; writes nothing yet. AdGuard Home has no zones: a rewrite may be for any name.
 *
 * `get` is the network, handed in so a test can answer in its place.
 */
export class AdGuardClient implements DnsProviderClient {
    readonly zoned = false;

    constructor(
        private readonly options: { url: string; username: string; password: string; allowSelfSigned: boolean },
        private readonly get: Get = httpGet,
    ) {}

    private async json(path: string): Promise<unknown> {
        const base = this.options.url.replace(/\/+$/, "");
        const auth = Buffer.from(`${this.options.username}:${this.options.password}`).toString("base64");
        const { status, body } = await this.get(`${base}${path}`, {
            headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
            insecure: this.options.allowSelfSigned,
            timeoutMs: TIMEOUT_MS,
        });
        if (status === 401 || status === 403) {
            // After five failed logins AdGuard Home refuses every login from the address for a
            // while (`auth_attempts`, `block_auth_min`), the right password included.
            throw new Error(
                "AdGuard Home refused the user name or the password. After several failed attempts it refuses this address for a while, even with the right password.",
            );
        }
        if (status === 404) throw new Error(`AdGuard Home does not know ${path} -- is ${base} the address of its web interface?`);
        if (status < 200 || status >= 300) throw new Error(`AdGuard Home answered HTTP ${status}${body ? `: ${body.trim().slice(0, 200)}` : ""}`);
        try {
            return JSON.parse(body);
        } catch {
            throw new Error(`${base} answered something that is not AdGuard Home's API`);
        }
    }

    private async rewrites(): Promise<AdGuardRewrite[]> {
        const list = await this.json("/control/rewrite/list");
        if (!Array.isArray(list)) throw new Error("AdGuard Home sent no list of rewrites");
        return list.filter(
            (r): r is AdGuardRewrite => typeof r?.domain === "string" && typeof r?.answer === "string",
        );
    }

    async test(): Promise<string> {
        const status = (await this.json("/control/status")) as { version?: unknown };
        const version = typeof status?.version === "string" ? ` ${status.version}` : "";
        const count = (await this.rewrites()).length;
        return `AdGuard Home${version} answered and holds ${count === 1 ? "1 DNS rewrite" : `${count} DNS rewrites`}.`;
    }

    async listZones() {
        return [];
    }

    async listRecords(): Promise<ProviderEntry[]> {
        return (await this.rewrites()).map(entryFromRewrite).filter((e): e is ProviderEntry => e !== null);
    }

    async close(): Promise<void> {}
}
