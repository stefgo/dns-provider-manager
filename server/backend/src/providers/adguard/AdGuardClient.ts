import type { DnsProviderClient, EntryRef, ProviderEntry, ProviderZoneInfo, RecordData } from "../DnsProvider.js";
import { AdGuardApi, type AdGuardOptions, type Request } from "./AdGuardApi.js";
import {
    entryFromRewrite,
    hasRewriteSettings,
    rewriteFor,
    rewriteOf,
    versionError,
    type AdGuardRewrite,
} from "./adguardMapping.js";

/**
 * One AdGuard Home instance, through the API of its web interface with Basic Auth: its DNS
 * rewrites. AdGuard Home has no zones: a rewrite may be for any name.
 *
 * `request` is the network, handed in so a test can answer in its place.
 */
export class AdGuardClient implements DnsProviderClient {
    readonly zoned = false;
    private readonly api: AdGuardApi;

    constructor(options: AdGuardOptions, request?: Request) {
        this.api = new AdGuardApi(options, request);
    }

    private async rewrites(): Promise<AdGuardRewrite[]> {
        const list = await this.api.json("/control/rewrite/list");
        if (!Array.isArray(list)) throw new Error("AdGuard Home sent no list of rewrites");
        return list.filter(
            (r): r is AdGuardRewrite => typeof r?.domain === "string" && typeof r?.answer === "string",
        );
    }

    /** The version AdGuard Home reports, such as `v0.107.79`; null when it names none. */
    version(): Promise<string | null> {
        return this.api.version();
    }

    /** Says what it found; a version dpm cannot write to is a failed test, not a remark. */
    async test(): Promise<string> {
        const version = await this.api.version();
        const tooOld = version && versionError(version);
        if (tooOld) throw new Error(tooOld);
        const count = (await this.rewrites()).length;
        let note = "";
        if (version && hasRewriteSettings(version)) {
            const settings = (await this.api.json("/control/rewrite/settings")) as { enabled?: unknown };
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
        await this.api.call("/control/rewrite/add", "POST", rewrite);
        return written(rewrite);
    }

    /** Switches the rewrite on as well: writing a record again is meant to make it answer. */
    async update(target: EntryRef, record: RecordData): Promise<ProviderEntry> {
        const current = rewriteOf(target.externalId);
        if (!current) throw new Error("This is not a rewrite AdGuard Home could find");
        const rewrite = { ...rewriteFor(record), enabled: true };
        await this.api.call("/control/rewrite/update", "PUT", { target: current, update: rewrite });
        return written(rewrite);
    }

    /**
     * Removes every rewrite with this domain and answer -- AdGuard Home tells two equal ones
     * apart no more than dpm does. One that is gone answers success as well.
     */
    async delete(target: EntryRef): Promise<void> {
        const current = rewriteOf(target.externalId);
        if (!current) throw new Error("This is not a rewrite AdGuard Home could find");
        await this.api.call("/control/rewrite/delete", "POST", current);
    }

    async close(): Promise<void> {}
}

function written(rewrite: AdGuardRewrite): ProviderEntry {
    const entry = entryFromRewrite(rewrite);
    if (!entry) throw new Error("AdGuard Home took a rewrite that is no record");
    return entry;
}
