import type { DnsProviderClient, EntryRef, ProviderEntry, ProviderZoneInfo, RecordData } from "../DnsProvider.js";
import { AdGuardApi, type AdGuardOptions, type Request } from "./AdGuardApi.js";
import { AdGuardClient } from "./AdGuardClient.js";
import { rewriteFor, rewriteOf, type AdGuardRewrite } from "./adguardMapping.js";

/** One node of a cluster as the client reaches it, its password in the clear. */
export interface ClusterNodeAccess extends AdGuardOptions {
    id: string;
    name: string;
    primary: boolean;
    /**
     * Whether a write of a record goes here as well, right after the primary: its rewrites are
     * in step with the primary's. A node that is not -- new, or behind -- is brought up to date
     * by the next run instead.
     */
    followsWrites: boolean;
}

export interface ClusterOptions {
    nodes: readonly ClusterNodeAccess[];
    /** A write of a record that did not reach a node: the next run brings it up to date. */
    onNodeBehind?: (nodeId: string, error: string) => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * An AdGuard Home cluster as one provider. What it holds is what its primary holds; a record
 * is written to the primary, then to every node that follows the writes. A node that fails is
 * not a failure of the record: it is reported through `onNodeBehind`, and the next run of the
 * cluster writes what it lacks.
 *
 * `request` is the network, handed in so a test can answer in its place.
 */
export class AdGuardClusterClient implements DnsProviderClient {
    readonly zoned = false;
    private readonly primary: AdGuardClient;
    private readonly primaryNode: ClusterNodeAccess;

    constructor(
        private readonly options: ClusterOptions,
        private readonly request?: Request,
    ) {
        const primary = options.nodes.find((n) => n.primary);
        if (!primary) throw new Error("The cluster has no primary");
        this.primaryNode = primary;
        this.primary = new AdGuardClient(primary, request);
    }

    private label(node: ClusterNodeAccess): string {
        return node.primary ? `${node.name} (primary)` : node.name;
    }

    /**
     * Asks every node, and says in a sentence each what it found. A node that does not answer
     * is a remark; the primary not answering is a failed test, since the cluster cannot be
     * read without it.
     */
    async test(): Promise<string> {
        const lines: string[] = [];
        const versions = new Set<string>();
        let primaryError = false;
        for (const node of this.options.nodes) {
            const client = new AdGuardClient(node, this.request);
            try {
                lines.push(`${this.label(node)}: ${await client.test()}`);
                const version = await client.version();
                if (version) versions.add(version);
            } catch (err) {
                if (node.primary) primaryError = true;
                lines.push(`${this.label(node)} failed: ${message(err)}`);
            }
        }
        if (versions.size > 1) {
            lines.push(`The nodes run different versions (${[...versions].sort().join(", ")}); what one of them does not know is not kept alike.`);
        }
        if (primaryError) throw new Error(lines.join(" "));
        return lines.join(" ");
    }

    async listZones() {
        return [];
    }

    listRecords(): Promise<ProviderEntry[]> {
        return this.primary.listRecords();
    }

    async create(zone: ProviderZoneInfo | null, record: RecordData): Promise<ProviderEntry> {
        const entry = await this.primary.create(zone, record);
        await this.followers((api) => ensure(api, record));
        return entry;
    }

    async update(target: EntryRef, record: RecordData): Promise<ProviderEntry> {
        const entry = await this.primary.update(target, record);
        await this.followers(async (api) => {
            const current = rewriteOf(target.externalId);
            const list = await rewrites(api);
            const wanted = rewriteFor(record);
            const holds = (r: { domain: string; answer: string }) => list.some((x) => x.domain === r.domain && x.answer === r.answer);
            if (current && holds(current) && !holds(wanted)) {
                await api.call("/control/rewrite/update", "PUT", { target: current, update: { ...wanted, enabled: true } });
                return;
            }
            // The old one is not there, or the new one is already: no change could say both.
            if (current && holds(current)) await api.call("/control/rewrite/delete", "POST", current);
            await ensure(api, record, list);
        });
        return entry;
    }

    async delete(target: EntryRef): Promise<void> {
        await this.primary.delete(target);
        const current = rewriteOf(target.externalId);
        if (!current) return;
        await this.followers((api) => api.call("/control/rewrite/delete", "POST", current).then(() => undefined));
    }

    async close(): Promise<void> {}

    /** Does `work` at each node that follows the writes, one after another; a failure is reported, not thrown. */
    private async followers(work: (api: AdGuardApi) => Promise<void>): Promise<void> {
        for (const node of this.options.nodes) {
            if (node.id === this.primaryNode.id || !node.followsWrites) continue;
            try {
                await work(new AdGuardApi(node, this.request));
            } catch (err) {
                this.options.onNodeBehind?.(node.id, message(err));
            }
        }
    }
}

async function rewrites(api: AdGuardApi): Promise<AdGuardRewrite[]> {
    const list = await api.json("/control/rewrite/list");
    if (!Array.isArray(list)) throw new Error("AdGuard Home sent no list of rewrites");
    return list.filter((r): r is AdGuardRewrite => typeof r?.domain === "string" && typeof r?.answer === "string");
}

/**
 * Makes the node hold the record, switched on. AdGuard Home adds a rewrite it holds already a
 * second time, so whether it is there is asked first.
 */
async function ensure(api: AdGuardApi, record: RecordData, known?: AdGuardRewrite[]): Promise<void> {
    const wanted = rewriteFor(record);
    const list = known ?? (await rewrites(api));
    const there = list.find((r) => r.domain === wanted.domain && r.answer === wanted.answer);
    if (!there) {
        await api.call("/control/rewrite/add", "POST", { ...wanted, enabled: true });
    } else if (there.enabled === false) {
        await api.call("/control/rewrite/update", "PUT", { target: wanted, update: { ...wanted, enabled: true } });
    }
}
