import type { DnsProviderClient, EntryRef, ProviderEntry, ProviderZoneInfo, RecordData } from "../DnsProvider.js";
import { httpRequest, type HttpOptions } from "../http.js";
import {
    entryFromRewrite,
    hasRewriteSettings,
    rewriteFor,
    rewriteOf,
    versionError,
    type AdGuardRewrite,
} from "./adguardMapping.js";

/** How long one call may take before it counts as unanswered. */
const TIMEOUT_MS = 10_000;

type Request = (url: string, options: HttpOptions) => ReturnType<typeof httpRequest>;

/**
 * One AdGuard Home instance, through the API of its web interface with Basic Auth: its DNS
 * rewrites. AdGuard Home has no zones: a rewrite may be for any name.
 *
 * `request` is the network, handed in so a test can answer in its place.
 */
export class AdGuardClient implements DnsProviderClient {
    readonly zoned = false;

    constructor(
        private readonly options: { url: string; username: string; password: string; allowSelfSigned: boolean },
        private readonly request: Request = httpRequest,
    ) {}

    /** One call; the body of a success as text. Throws with a sentence otherwise. */
    private async call(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<string> {
        const base = this.options.url.replace(/\/+$/, "");
        const auth = Buffer.from(`${this.options.username}:${this.options.password}`).toString("base64");
        const { status, body: text } = await this.request(`${base}${path}`, {
            method,
            body,
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
        if (status < 200 || status >= 300) {
            throw new Error(`AdGuard Home refused it (HTTP ${status})${text ? `: ${text.trim().slice(0, 200)}` : ""}`);
        }
        return text;
    }

    private async json(path: string): Promise<unknown> {
        const text = await this.call(path);
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`${this.options.url} answered something that is not AdGuard Home's API`);
        }
    }

    private async rewrites(): Promise<AdGuardRewrite[]> {
        const list = await this.json("/control/rewrite/list");
        if (!Array.isArray(list)) throw new Error("AdGuard Home sent no list of rewrites");
        return list.filter(
            (r): r is AdGuardRewrite => typeof r?.domain === "string" && typeof r?.answer === "string",
        );
    }

    /** Says what it found; a version dpm cannot write to is a failed test, not a remark. */
    async test(): Promise<string> {
        const status = (await this.json("/control/status")) as { version?: unknown };
        const version = typeof status?.version === "string" ? status.version : null;
        const tooOld = version && versionError(version);
        if (tooOld) throw new Error(tooOld);
        const count = (await this.rewrites()).length;
        let note = "";
        if (version && hasRewriteSettings(version)) {
            const settings = (await this.json("/control/rewrite/settings")) as { enabled?: unknown };
            if (settings?.enabled === false) note = " Its rewrites are switched off as a whole in its settings, so none of them is answered.";
        }
        return `AdGuard Home${version ? ` ${version}` : ""} answered and holds ${count === 1 ? "1 DNS rewrite" : `${count} DNS rewrites`}.${note}`;
    }

    async listZones() {
        return [];
    }

    async listRecords(): Promise<ProviderEntry[]> {
        return (await this.rewrites()).map(entryFromRewrite).filter((e): e is ProviderEntry => e !== null);
    }

    /**
     * AdGuard Home adds a rewrite it holds already a second time, so whether it is there is
     * asked first -- by the caller, from the last reading.
     */
    async create(_zone: ProviderZoneInfo | null, record: RecordData): Promise<ProviderEntry> {
        const rewrite = { ...rewriteFor(record), enabled: true };
        await this.call("/control/rewrite/add", "POST", rewrite);
        return written(rewrite);
    }

    /** Switches the rewrite on as well: writing a record again is meant to make it answer. */
    async update(target: EntryRef, record: RecordData): Promise<ProviderEntry> {
        const current = rewriteOf(target.externalId);
        if (!current) throw new Error("This is not a rewrite AdGuard Home could find");
        const rewrite = { ...rewriteFor(record), enabled: true };
        await this.call("/control/rewrite/update", "PUT", { target: current, update: rewrite });
        return written(rewrite);
    }

    /**
     * Removes every rewrite with this domain and answer -- AdGuard Home tells two equal ones
     * apart no more than dpm does. One that is gone answers success as well.
     */
    async delete(target: EntryRef): Promise<void> {
        const current = rewriteOf(target.externalId);
        if (!current) throw new Error("This is not a rewrite AdGuard Home could find");
        await this.call("/control/rewrite/delete", "POST", current);
    }

    async close(): Promise<void> {}
}

function written(rewrite: AdGuardRewrite): ProviderEntry {
    const entry = entryFromRewrite(rewrite);
    if (!entry) throw new Error("AdGuard Home took a rewrite that is no record");
    return entry;
}
