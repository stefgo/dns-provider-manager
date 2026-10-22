import type { DnsProviderClient, EntryRef, ProviderEntry, ProviderZoneInfo, RecordData } from "../DnsProvider.js";
import {
    cloudflareBody,
    cloudflareErrors,
    entryFromCloudflare,
    type CloudflareRecord,
    type CloudflareZone,
} from "./cloudflareMapping.js";

/**
 * Cloudflare's API. `DPM_CLOUDFLARE_API_URL` points it elsewhere -- only for tests against a
 * stand-in, never for an installation.
 */
const apiUrl = () => process.env.DPM_CLOUDFLARE_API_URL || "https://api.cloudflare.com/client/v4";

/** How long one call may take before it counts as unanswered. */
const TIMEOUT_MS = 15_000;

/** Cloudflare caps a page of zones at 50; records go in larger pages. */
const ZONES_PER_PAGE = 50;
const RECORDS_PER_PAGE = 1000;

/** No account has this many pages; a broken `total_pages` must not keep the loop going. */
const MAX_PAGES = 200;

type Fetch = typeof fetch;

interface Page<T> {
    result: T[];
    result_info?: { page?: number; total_pages?: number };
}

/** A refusal that says the record is not there (`DELETE` of an id that is gone). */
class NotFound extends Error {}

/**
 * Cloudflare's API v4 with one API token: zones and DNS records. Every record is written one
 * by one; `comment` is never sent, so what someone noted at Cloudflare stays.
 *
 * `fetchImpl` is the network, handed in so a test can answer in its place.
 */
export class CloudflareClient implements DnsProviderClient {
    readonly zoned = true;

    constructor(
        private readonly token: string,
        private readonly fetchImpl: Fetch = fetch,
    ) {}

    /**
     * One call. Answers the `result` and the paging of a success; throws with Cloudflare's own
     * reason on a refusal.
     */
    private async call(
        method: "GET" | "POST" | "PATCH" | "DELETE",
        path: string,
        { params, body }: { params?: Record<string, string>; body?: unknown } = {},
    ): Promise<{ result: unknown; result_info?: Page<unknown>["result_info"] }> {
        let response: Response;
        try {
            response = await this.fetchImpl(`${apiUrl()}${path}${params ? `?${new URLSearchParams(params)}` : ""}`, {
                method,
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    Accept: "application/json",
                    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (err) {
            if (err instanceof Error && err.name === "TimeoutError") {
                throw new Error(`Cloudflare did not answer within ${TIMEOUT_MS / 1000} s`, { cause: err });
            }
            throw new Error(`Cloudflare could not be reached: ${err instanceof Error ? err.message : String(err)}`, {
                cause: err,
            });
        }
        const answer: unknown = await response.json().catch(() => null);
        const success = (answer as { success?: unknown } | null)?.success === true;
        if (!response.ok || !success) {
            const reason = cloudflareErrors(answer) ?? `HTTP ${response.status}`;
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Cloudflare refused the API token: ${reason}`);
            }
            if (response.status === 404) throw new NotFound(`Cloudflare does not know it: ${reason}`);
            throw new Error(`Cloudflare refused the request: ${reason}`);
        }
        const { result, result_info } = answer as { result?: unknown; result_info?: Page<unknown>["result_info"] };
        return { result, result_info };
    }

    /** One page of a list. */
    private async page<T>(path: string, params: Record<string, string>): Promise<Page<T>> {
        const { result, result_info } = await this.call("GET", path, { params });
        return { result: Array.isArray(result) ? (result as T[]) : [], result_info };
    }

    /** Every page of a list, one after another. */
    private async all<T>(path: string, perPage: number): Promise<T[]> {
        const items: T[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
            const { result, result_info } = await this.page<T>(path, { page: String(page), per_page: String(perPage) });
            items.push(...result);
            const total = result_info?.total_pages ?? 1;
            if (page >= total || result.length === 0) break;
        }
        return items;
    }

    async listZones(): Promise<ProviderZoneInfo[]> {
        const zones = await this.all<CloudflareZone>("/zones", ZONES_PER_PAGE);
        return zones.map((zone) => ({ id: zone.id, name: zone.name.toLowerCase() }));
    }

    async test(): Promise<string> {
        const zones = await this.listZones();
        return `Cloudflare answered and lists ${zones.length === 1 ? "1 zone" : `${zones.length} zones`}.`;
    }

    async close(): Promise<void> {}

    async listRecords(zone: ProviderZoneInfo | null): Promise<ProviderEntry[]> {
        if (!zone) return [];
        const records = await this.all<CloudflareRecord>(`/zones/${encodeURIComponent(zone.id)}/dns_records`, RECORDS_PER_PAGE);
        return records.map((record) => entryFromCloudflare(record, zone)).filter((e): e is ProviderEntry => e !== null);
    }

    /** The record Cloudflare answers a write with, as an entry. */
    private written(result: unknown, zone: ProviderZoneInfo): ProviderEntry {
        const entry = result && typeof result === "object" ? entryFromCloudflare(result as CloudflareRecord, zone) : null;
        if (!entry) throw new Error("Cloudflare accepted the record but did not send it back");
        return entry;
    }

    async create(zone: ProviderZoneInfo | null, record: RecordData): Promise<ProviderEntry> {
        if (!zone) throw new Error("A Cloudflare record needs a zone");
        const { result } = await this.call("POST", `/zones/${encodeURIComponent(zone.id)}/dns_records`, { body: cloudflareBody(record) });
        return this.written(result, zone);
    }

    async update(target: EntryRef, record: RecordData): Promise<ProviderEntry> {
        const zone = zoneOf(target);
        const { result } = await this.call(
            "PATCH",
            `/zones/${encodeURIComponent(zone.id)}/dns_records/${encodeURIComponent(target.externalId)}`,
            { body: cloudflareBody(record) },
        );
        return this.written(result, zone);
    }

    async delete(target: EntryRef): Promise<void> {
        const zone = zoneOf(target);
        try {
            await this.call("DELETE", `/zones/${encodeURIComponent(zone.id)}/dns_records/${encodeURIComponent(target.externalId)}`);
        } catch (err) {
            // Gone already: what the deletion was for.
            if (!(err instanceof NotFound)) throw err;
        }
    }
}

function zoneOf(target: EntryRef): ProviderZoneInfo {
    if (!target.zoneId) throw new Error("A Cloudflare record needs a zone");
    return { id: target.zoneId, name: target.zone ?? "" };
}
