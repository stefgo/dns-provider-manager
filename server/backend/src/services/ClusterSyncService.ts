import {
    CONFIG_AREA_LABELS,
    FIXED_CONFIG_AREAS,
    WS_EVENTS,
    type ClusterPreview,
    type ClusterStatus,
    type ConfigArea,
    type Provider,
    type ProviderFields,
    type SchedulerStatus,
    type SchedulerTrigger,
} from "@dpm/shared";
import { logger } from "@dpm/shared/node";
import { appConfig } from "../config/AppConfig.js";
import type { AdGuardApi } from "../providers/adguard/AdGuardApi.js";
import type { ClusterNodeAccess } from "../providers/adguard/AdGuardClusterClient.js";
import { versionAtLeast } from "../providers/adguard/adguardMapping.js";
import { adguardApiFor } from "../providers/clients.js";
import { configAreaSync, inRunOrder, type AnyConfigAreaSync } from "../providers/configAreas.js";
import { commonShape, project, stateHash } from "../providers/configState.js";
import { ClusterRepository, type ClusterLink, type ClusterSettings } from "../repositories/ClusterRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ActivityService } from "./ActivityService.js";
import { prepareArea, type AreaState } from "./clusterSyncPlan.js";
import { DashboardService } from "./DashboardService.js";
import { clusterNodeAccess, editorNodeAccess } from "./providerAccess.js";
import { queueFor } from "./providerQueue.js";
import { RequestError } from "./RequestError.js";
import { ScheduledJob } from "./ScheduledJob.js";

type ClusterProvider = Extract<Provider, { type: "adguard-cluster" }>;
type ClusterFields = Extract<ProviderFields, { type: "adguard-cluster" }>;

/** At most this many changes are named in one event; the rest are counted. */
const MAX_STEPS_NAMED = 20;

const intervalMinutes = () => {
    const minutes = parseInt(appConfig.settings.cluster_sync_interval_minutes ?? "1", 10);
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : 1;
};

const job = new ScheduledJob({
    id: "cluster-sync",
    intervalMs: () => intervalMinutes() * 60 * 1000,
    outcome: (result) => (result.failed > 0 ? "partial" : "success"),
});

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const named = (steps: readonly string[]) =>
    steps.length <= MAX_STEPS_NAMED ? [...steps] : [...steps.slice(0, MAX_STEPS_NAMED), `and ${steps.length - MAX_STEPS_NAMED} more`];

/** Adds what `list` does not hold yet, in order: several nodes written in one run name a change once. */
const addNew = (list: string[], items: readonly string[]) => {
    for (const item of items) if (!list.includes(item)) list.push(item);
};

/** What a cluster keeps alike, the fixed areas always among it, in the order a run goes through them. */
const areasOf = (areas: readonly ConfigArea[]) => inRunOrder([...FIXED_CONFIG_AREAS, ...areas]);

function clusters(): ClusterProvider[] {
    return ProviderRepository.findAll().filter((p): p is ClusterProvider => p.type === "adguard-cluster");
}

function clusterById(providerId: string): ClusterProvider | null {
    const provider = ProviderRepository.findById(providerId);
    return provider?.type === "adguard-cluster" ? provider : null;
}

/** One node as a run read it: every area asked for, or why the node could not be reached. */
interface NodeReading {
    node: ClusterNodeAccess;
    api: AdGuardApi | null;
    version: string | null;
    error: string | null;
    areas: Map<ConfigArea, AreaState>;
}

/** Reads `areas` from one node. */
async function readNode(node: ClusterNodeAccess, areas: readonly ConfigArea[]): Promise<NodeReading> {
    const reading: NodeReading = { node, api: null, version: null, error: null, areas: new Map() };
    const api = adguardApiFor(node, node.password);
    let version: string | null;
    try {
        version = await api.version();
    } catch (err) {
        return { ...reading, error: message(err) };
    }
    for (const area of areas) {
        const sync = configAreaSync(area);
        if (sync.minVersion && version && !versionAtLeast(version, sync.minVersion)) {
            reading.areas.set(area, {
                ok: false,
                error: `${CONFIG_AREA_LABELS[area]} need AdGuard Home ${sync.minVersion} or later; ${node.name} runs ${version}`,
            });
            continue;
        }
        try {
            reading.areas.set(area, { ok: true, state: sync.normalise(await sync.read(api)) });
        } catch (err) {
            reading.areas.set(area, { ok: false, error: message(err) });
        }
    }
    return { ...reading, api, version };
}

const areaOf = (reading: NodeReading, area: ConfigArea): AreaState =>
    reading.error !== null ? { ok: false, error: reading.error } : (reading.areas.get(area) ?? { ok: false, error: "Not read" });

/** Remembers at the node what a run found there. */
function markNode(reading: NodeReading, at: string): void {
    ClusterRepository.markNode(reading.node.id, at, reading.error !== null ? { error: reading.error } : { version: reading.version });
}

function broadcast(providerId: string): void {
    DashboardService.broadcastToDashboard({ type: WS_EVENTS.CLUSTER_UPDATE, payload: { providerId } });
}

/** What one run of a cluster did. */
interface Outcome {
    written: number;
    failed: number;
}

/** What a run collects across the areas of a cluster, for one event each rather than one per area. */
interface RunEvents {
    propagated: { areas: string[]; steps: string[]; nodes: Set<string> };
    corrected: Map<string, { areas: string[]; steps: string[] }>;
}

/** The parts of a run every step of it needs. */
interface RunContext {
    cluster: ClusterProvider;
    primary: ClusterNodeAccess;
    events: RunEvents;
    outcome: Outcome;
}

/**
 * Keeps the nodes of each AdGuard Home cluster alike: the primary is the source, every other
 * node is made to hold what it holds, area by area. Runs on its own timer and on request
 * ("Sync now"); saving a cluster starts no run. A run of a cluster goes through the cluster's
 * queue, so the records are not written to it meanwhile.
 *
 * What a run decides is `prepareArea` and `planArea`; this reads, writes and remembers.
 */
export class ClusterSyncService {
    // ── Status ───────────────────────────────────────────────────────────────

    static status(providerId: string): ClusterStatus | null {
        const cluster = clusterById(providerId);
        if (!cluster) return null;
        return this.statusOf(cluster, ClusterRepository.settings(providerId));
    }

    /** Every cluster's status, for the dashboard's findings and the provider list. */
    static statuses(): ClusterStatus[] {
        const settings = new Map(ClusterRepository.allSettings().map((s) => [s.providerId, s]));
        return clusters().map((cluster) => this.statusOf(cluster, settings.get(cluster.id) ?? null));
    }

    private static statusOf(cluster: ClusterProvider, settings: ClusterSettings | null): ClusterStatus {
        return {
            providerId: cluster.id,
            primaryNodeId: cluster.nodes.find((n) => n.primary)?.id ?? null,
            areas: areasOf(cluster.areas),
            pausedError: settings?.pausedError ?? null,
            lastRunAt: settings?.lastRunAt ?? null,
            links: ClusterRepository.links(cluster.id).map(({ nodeId, area, status, error, attempts, lastAttemptAt, syncedAt }) => ({
                nodeId,
                area,
                status,
                error,
                attempts,
                lastAttemptAt,
                syncedAt,
            })),
        };
    }

    // ── Preview ──────────────────────────────────────────────────────────────

    /**
     * What saving a cluster as the editor holds it would write to each node that starts over:
     * a node new to the cluster, an area switched on, every node when the primary changes. A
     * node that is kept alike already is not asked about -- what it is written is what the
     * primary changes. Read from the instances now; changes nothing.
     */
    static async preview(fields: ClusterFields, id?: string): Promise<ClusterPreview> {
        const before = id ? clusterById(id) : null;
        if (id && !before) throw new RequestError(404, "Provider not found");
        const nodes = editorNodeAccess(fields, id);
        const primary = nodes.find((n) => n.primary);
        if (!primary) throw new RequestError(400, "Choose one node as the primary");
        const areas = areasOf(fields.areas);
        const beforePrimary = before?.nodes.find((n) => n.primary)?.id ?? null;
        const startsOver = (node: ClusterNodeAccess): ConfigArea[] => {
            if (!before || beforePrimary !== primary.id || !before.nodes.some((n) => n.id === node.id)) return areas;
            return areas.filter((area) => !before.areas.includes(area));
        };
        const asked = nodes.filter((n) => !n.primary).map((node) => ({ node, areas: startsOver(node) })).filter((a) => a.areas.length > 0);
        if (asked.length === 0) return { error: null, nodes: [] };

        const [primaryReading, ...readings] = await Promise.all([readNode(primary, areas), ...asked.map((a) => readNode(a.node, a.areas))]);
        if (primaryReading.error !== null) return { error: `${primary.name} cannot be read: ${primaryReading.error}`, nodes: [] };
        return {
            error: null,
            nodes: readings.map((reading, i) => ({
                name: reading.node.name,
                areas: asked[i].areas.map((area) => {
                    const sync = configAreaSync(area);
                    const source = areaOf(primaryReading, area);
                    const copy = areaOf(reading, area);
                    if (!source.ok) return { area, steps: [], error: `${primary.name}: ${source.error}` };
                    if (!copy.ok) return { area, steps: [], error: copy.error };
                    const readable = readings.map((r) => areaOf(r, area)).flatMap((a) => (a.ok ? [a.state] : []));
                    const shape = commonShape([source.state, ...readable]);
                    return { area, steps: sync.diff(project(source.state, shape), project(copy.state, shape)).map((s) => sync.describe(s)), error: null };
                }),
            })),
        };
    }

    // ── Runs ─────────────────────────────────────────────────────────────────

    /** Keeps one cluster alike now, or after the run or the writes under way at it. */
    static runCluster(providerId: string): Promise<Outcome> {
        return queueFor(providerId, () => this.runNow(providerId));
    }

    /** Every cluster, one after another, as one run of the scheduler. */
    static run(trigger: SchedulerTrigger = "schedule"): Promise<{ clusters: number; written: number; failed: number }> {
        return job.run(trigger, async () => {
            const total = { clusters: 0, written: 0, failed: 0 };
            for (const cluster of clusters()) {
                total.clusters++;
                try {
                    const outcome = await this.runCluster(cluster.id);
                    total.written += outcome.written;
                    total.failed += outcome.failed;
                } catch (err) {
                    total.failed++;
                    logger.error({ err, cluster: cluster.name }, "Keeping a cluster alike failed");
                }
            }
            return total;
        });
    }

    private static async runNow(providerId: string): Promise<Outcome> {
        const outcome: Outcome = { written: 0, failed: 0 };
        const cluster = clusterById(providerId);
        const settings = ClusterRepository.settings(providerId);
        if (!cluster || !settings) return outcome;
        const nodes = clusterNodeAccess(cluster);
        const primary = nodes?.find((n) => n.primary);
        if (!nodes || !primary) return outcome;

        const areas = areasOf(cluster.areas);
        const copies = nodes.filter((n) => n !== primary);
        ClusterRepository.keepOnly(providerId, primary.id, areas);

        const [primaryReading, ...copyReadings] = await Promise.all([primary, ...copies].map((n) => readNode(n, areas)));
        // The run counts once the nodes are read, whether the primary answered or not.
        const now = new Date().toISOString();
        ClusterRepository.setLastRun(providerId, now);
        for (const reading of [primaryReading, ...copyReadings]) markNode(reading, now);
        if (primaryReading.error !== null) {
            this.pause(cluster, settings, primary, primaryReading.error);
            broadcast(providerId);
            return { ...outcome, failed: 1 };
        }
        if (settings.pausedError !== null) {
            ClusterRepository.setPausedError(providerId, null);
            ActivityService.record({
                kind: "cluster.resumed",
                level: "info",
                subject: { providerId },
                data: { cluster: cluster.name, primary: primary.name },
            });
        }

        const context: RunContext = {
            cluster,
            primary,
            events: { propagated: { areas: [], steps: [], nodes: new Set() }, corrected: new Map() },
            outcome,
        };
        for (const area of areas) await this.syncArea(context, area, primaryReading, copyReadings);
        this.report(context);
        broadcast(providerId);
        return outcome;
    }

    /** One area of one cluster: plans, writes what the plan says to each node, and remembers. */
    private static async syncArea(context: RunContext, area: ConfigArea, primaryReading: NodeReading, copyReadings: readonly NodeReading[]): Promise<void> {
        const { cluster, primary, events, outcome } = context;
        const sync = configAreaSync(area);
        const links = new Map(ClusterRepository.links(cluster.id).filter((l) => l.area === area).map((l) => [l.nodeId, l]));
        const baseline = ClusterRepository.baseline(cluster.id, area);
        const primaryArea = areaOf(primaryReading, area);
        const prepared = prepareArea(
            sync,
            primaryArea,
            baseline?.state ?? null,
            copyReadings.map((r) => ({
                nodeId: r.node.id,
                area: areaOf(r, area),
                writtenHash: links.get(r.node.id)?.writtenHash ?? null,
                lastStatus: links.get(r.node.id)?.status ?? null,
            })),
        );
        const { plan } = prepared;
        const now = new Date().toISOString();

        if (plan.kind === "paused") {
            // The primary answered but cannot give this area: it is too old for it, or refused.
            for (const reading of copyReadings) {
                this.saveLink(reading.node.id, area, links.get(reading.node.id), { status: "paused", error: `${primary.name}: ${plan.error}` });
            }
            outcome.failed++;
            return;
        }

        // The primary's state moves on whatever the nodes make of it.
        const primaryState = (primaryArea as { ok: true; state: unknown }).state;
        const primaryHash = stateHash(primaryState);
        if (baseline?.hash !== primaryHash) ClusterRepository.saveBaseline(cluster.id, area, { state: primaryState, hash: primaryHash });

        for (const action of plan.copies) {
            const reading = copyReadings.find((r) => r.node.id === action.nodeId)!;
            const link = links.get(action.nodeId);
            switch (action.kind) {
                case "unreachable":
                    // A node that is down is tried again; one that answered but cannot give this
                    // area -- too old for it, or it refused -- is a failure, said once.
                    if (reading.error === null) this.failed(context, area, reading.node, link, action.error, link?.writtenHash ?? null, link?.attempts ?? 0, now);
                    else this.saveLink(action.nodeId, area, link, { status: "pending", error: action.error });
                    outcome.failed++;
                    break;
                case "none": {
                    const own = stateHash((areaOf(reading, area) as { ok: true; state: unknown }).state);
                    this.saveLink(action.nodeId, area, link, {
                        status: "in_sync",
                        error: null,
                        writtenHash: own,
                        attempts: 0,
                        syncedAt: link?.status === "in_sync" ? link.syncedAt : now,
                    });
                    break;
                }
                case "update":
                case "correct": {
                    const correcting = action.kind === "correct";
                    const written = await this.write(context, area, sync, prepared.target, prepared.shape, primaryState, reading, link, correcting);
                    if (written === null) {
                        outcome.failed++;
                        break;
                    }
                    outcome.written++;
                    // The node holds the primary's state now: a change made at the primary reached
                    // it, or it was behind -- new to the cluster, or a write that failed before. A
                    // node whose own change was written over has an event of its own besides.
                    if (!correcting || plan.propagated) {
                        events.propagated.nodes.add(reading.node.name);
                        addNew(events.propagated.areas, [CONFIG_AREA_LABELS[area]]);
                        addNew(events.propagated.steps, plan.propagated ? prepared.primaryChanges : written);
                    }
                    break;
                }
            }
        }
    }

    /**
     * Writes the primary's state to one node, reads it back and remembers what it holds now.
     * Answers what it wrote, a sentence each, or null when the write failed.
     */
    private static async write(
        context: RunContext,
        area: ConfigArea,
        sync: AnyConfigAreaSync,
        target: unknown,
        shape: ReturnType<typeof commonShape>,
        primaryState: unknown,
        reading: NodeReading,
        link: ClusterLink | undefined,
        correcting: boolean,
    ): Promise<string[] | null> {
        const node = reading.node;
        const api = reading.api!;
        const current = (areaOf(reading, area) as { ok: true; state: unknown }).state;
        const steps = sync.diff(target, project(current, shape));
        const described = steps.map((s) => sync.describe(s));
        const now = new Date().toISOString();
        const attempts = (link?.attempts ?? 0) + 1;
        try {
            await sync.apply(api, steps);
            const after = sync.normalise(await sync.read(api));
            const own = stateHash(after);
            // Compared on what both know now: the node may know fewer fields than the cluster did before it was written.
            const shapeAfter = commonShape([primaryState, after]);
            const left = sync.diff(project(primaryState, shapeAfter), project(after, shapeAfter)).map((s) => sync.describe(s));
            if (left.length > 0) {
                this.failed(context, area, node, link, `Still differs after writing: ${named(left).join("; ")}`, own, attempts, now);
                return null;
            }
            this.saveLink(node.id, area, link, { status: "in_sync", error: null, writtenHash: own, attempts: 0, lastAttemptAt: now, syncedAt: now });
            if (correcting) {
                logger.warn({ cluster: context.cluster.name, node: node.name, area, steps: described }, "A change at a node of a cluster written over");
                const entry = context.events.corrected.get(node.id) ?? { areas: [], steps: [] };
                entry.areas.push(CONFIG_AREA_LABELS[area]);
                entry.steps.push(...described);
                context.events.corrected.set(node.id, entry);
            }
            return described;
        } catch (err) {
            this.failed(context, area, node, link, message(err), link?.writtenHash ?? null, attempts, now);
            return null;
        }
    }

    /** Remembers a failed write; reports it the first time and whenever the reason changes. */
    private static failed(
        { cluster }: RunContext,
        area: ConfigArea,
        node: ClusterNodeAccess,
        link: ClusterLink | undefined,
        error: string,
        writtenHash: string | null,
        attempts: number,
        at: string,
    ): void {
        this.saveLink(node.id, area, link, { status: "error", error, writtenHash, attempts, lastAttemptAt: at });
        if (link?.status === "error" && link.error === error) return;
        logger.warn({ cluster: cluster.name, node: node.name, area, error }, "Writing to a node of a cluster failed");
        ActivityService.record({
            kind: "cluster.write_failed",
            level: "error",
            subject: { providerId: cluster.id },
            data: { cluster: cluster.name, node: node.name, area: CONFIG_AREA_LABELS[area], error },
        });
    }

    /** Writes a link, unless nothing about it changed: a run every minute leaves most as they are. */
    private static saveLink(nodeId: string, area: ConfigArea, before: ClusterLink | undefined, change: Partial<ClusterLink>): void {
        const next: ClusterLink = {
            nodeId,
            area,
            writtenHash: before?.writtenHash ?? null,
            status: before?.status ?? "pending",
            error: before?.error ?? null,
            attempts: before?.attempts ?? 0,
            lastAttemptAt: before?.lastAttemptAt ?? null,
            syncedAt: before?.syncedAt ?? null,
            ...change,
        };
        if (before && JSON.stringify(before) === JSON.stringify({ ...before, ...next })) return;
        ClusterRepository.saveLink(next);
    }

    /** One event for what changed at the primary, one per node that was changed by hand. */
    private static report({ cluster, primary, events }: RunContext): void {
        const { propagated, corrected } = events;
        if (propagated.areas.length > 0) {
            ActivityService.record({
                kind: "cluster.propagated",
                level: "info",
                subject: { providerId: cluster.id },
                data: {
                    cluster: cluster.name,
                    primary: primary.name,
                    areas: propagated.areas,
                    nodes: [...propagated.nodes].sort(),
                    steps: named(propagated.steps),
                },
            });
        }
        for (const [nodeId, { areas, steps }] of corrected) {
            ActivityService.record({
                kind: "cluster.corrected",
                level: "warning",
                subject: { providerId: cluster.id },
                data: {
                    cluster: cluster.name,
                    primary: primary.name,
                    node: cluster.nodes.find((n) => n.id === nodeId)?.name ?? nodeId,
                    areas,
                    steps: named(steps),
                },
            });
        }
    }

    /** The primary cannot be read: nothing is written. Reported when it starts, not every run. */
    private static pause(cluster: ClusterProvider, settings: ClusterSettings, primary: ClusterNodeAccess, error: string): void {
        ClusterRepository.markAll(cluster.id, "paused", `${primary.name} cannot be read: ${error}`);
        ClusterRepository.setPausedError(cluster.id, error);
        if (settings.pausedError !== null) return;
        logger.warn({ cluster: cluster.name, primary: primary.name, error }, "Cluster paused: its primary cannot be read");
        ActivityService.record({
            kind: "cluster.paused",
            level: "warning",
            subject: { providerId: cluster.id },
            data: { cluster: cluster.name, primary: primary.name, error },
        });
    }

    // ── Scheduler ────────────────────────────────────────────────────────────

    static startScheduler(): void {
        job.start(() => this.run("schedule"));
    }

    static stopScheduler(): void {
        job.stop();
    }

    static restartScheduler(): void {
        this.startScheduler();
    }

    static getStatus(): SchedulerStatus<"cluster-sync"> {
        return job.status();
    }
}
