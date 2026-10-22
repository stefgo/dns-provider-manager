import type { DnsProviderClient, ProviderEntry, ProviderZoneInfo } from "../DnsProvider.js";
import {
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

/**
 * Cloudflare's API v4 with one API token. Reads zones and DNS records; writes nothing yet.
 *
 * `fetchImpl` is the network, handed in so a test can answer in its place.
 */
export class CloudflareClient implements DnsProviderClient {
    readonly zoned = true;

    constructor(
        private readonly token: string,
        private readonly fetchImpl: Fetch = fetch,
    ) {}

    /** One page of a list. Throws with Cloudflare's own reason on a refusal. */
    private async page<T>(path: string, params: Record<string, string>): Promise<Page<T>> {
        let response: Response;
        try {
            response = await this.fetchImpl(`${apiUrl()}${path}?${new URLSearchParams(params)}`, {
                headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
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
        const body: unknown = await response.json().catch(() => null);
        const success = (body as { success?: unknown } | null)?.success === true;
        if (!response.ok || !success) {
            const reason = cloudflareErrors(body) ?? `HTTP ${response.status}`;
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Cloudflare refused the API token: ${reason}`);
            }
            throw new Error(`Cloudflare refused the request: ${reason}`);
        }
        const result = (body as { result?: unknown }).result;
        return { result: Array.isArray(result) ? (result as T[]) : [], result_info: (body as Page<T>).result_info };
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
}
