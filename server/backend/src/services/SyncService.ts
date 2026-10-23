import {
    WS_EVENTS,
    type ActivityKind,
    type ActivityLevel,
    type DnsRecord,
    type LinkStatus,
    type PendingRemoval,
    type Provider,
    type RecordFields,
    type RecordLinkView,
    type RecordPreview,
    type Site,
    type SiteFields,
    type SitePreview,
    type SyncStepView,
} from "@dpm/shared";
import { logger } from "@dpm/shared/node";
import type { DnsProviderClient, ProviderEntry, RecordData } from "../providers/DnsProvider.js";
import { clientFor } from "../providers/clients.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { RecordLinkRepository, type Observed, type RecordLink } from "../repositories/RecordLinkRepository.js";
import { RecordRepository, type StoredRecord } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { ActivityService } from "./ActivityService.js";
import { DashboardService } from "./DashboardService.js";
import { ProviderReadService } from "./ProviderReadService.js";
import { decryptSecret } from "./SecretCrypto.js";
import { queueFor } from "./providerQueue.js";
import { recordTargets, type RecordTargets } from "./recordTargets.js";
import { claimKey, dataFor, planRecord, type DesiredRecord, type PlanContext, type Step } from "./syncPlan.js";

/** What a run needs, read once: who the providers and sites are. */
interface World {
    providers: Provider[];
    sites: Site[];
}

const loadWorld = (): World => ({ providers: ProviderRepository.findAll(), sites: SiteRepository.findAll() });

export interface SyncOptions {
    /** Only these providers are written to; for the others, the plan is only looked at. */
    only?: ReadonlySet<string>;
    /** The providers whose drift is to be written over with dpm's value. */
    correct?: ReadonlySet<string>;
    /** Correcting by itself, because the provider says so -- as the activity puts it. */
    auto?: boolean;
    correlationId?: string | null;
    user?: string | null;
}

const desiredOf = (record: Pick<StoredRecord, "name" | "type" | "value" | "settings">): DesiredRecord => ({
    name: record.name,
    type: record.type,
    value: record.value,
    settings: record.settings,
});

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function targetsOf(record: Pick<StoredRecord, "name" | "siteIds">, world: World): RecordTargets {
    return recordTargets(record, world.sites, world.providers);
}

/** The plan's view of the providers, the last readings and what other records hold. */
function planContext(world: World, recordId: string | undefined, links: readonly RecordLink[]): PlanContext {
    const claimed = new Set<string>();
    for (const link of links) {
        if (link.recordId === recordId) continue;
        if (link.externalId) claimed.add(claimKey(link.providerId, link.externalId));
        if (link.observed) claimed.add(claimKey(link.providerId, link.observed.externalId));
    }
    return {
        providers: new Map(world.providers.map((p) => [p.id, { id: p.id, name: p.name, type: p.type, readOnly: p.readOnly, writable: p.writable }])),
        readings: ProviderReadService.entries(),
        claimed,
    };
}

/** What a reader of the activity learns of a record and a provider. */
function facts(data: RecordData | null, provider: Provider | undefined) {
    return { name: data?.name ?? "?", type: data?.type ?? "", value: data?.value ?? "", provider: provider?.name ?? "a provider" };
}

/** How an observed entry is named in a sentence. */
const describeObserved = (observed: Observed | null) =>
    observed === null ? null : observed.disabled ? `${observed.value}, switched off` : observed.value;

/** The records a sync is under way for, and how many. */
const underway = new Map<string, number>();
/**
 * Records released while a sync of theirs was under way. What that sync still learns is not
 * saved: a link left behind for a record that is gone would be a removal at the provider.
 */
const released = new Set<string>();

const blank = (recordId: string, providerId: string): RecordLink => ({
    recordId,
    providerId,
    zoneId: null,
    externalId: null,
    written: null,
    status: "pending",
    error: null,
    observed: null,
    attempts: 0,
    lastAttemptAt: null,
    syncedAt: null,
});

/**
 * One record brought to its providers: plans it (`planRecord`) and does what the plan says,
 * provider by provider in each provider's queue. Writes and changes go first, all providers
 * side by side; removals only after them, and only once the record is in place everywhere it
 * goes -- a record that moves from Cloudflare to the AdGuard Home instances is deleted at
 * Cloudflare once both of them hold it, not before.
 *
 * Answers whether anything about the record changed.
 */
async function syncOne(recordId: string, world: World, options: SyncOptions): Promise<boolean> {
    const record = RecordRepository.findById(recordId) ?? null;
    const allLinks = RecordLinkRepository.findAll();
    const links = allLinks.filter((l) => l.recordId === recordId);
    if (!record && links.length === 0) return false;

    const desired = record ? desiredOf(record) : null;
    const targets = record ? targetsOf(record, world).targets : [];
    const steps = planRecord(desired, targets, links, planContext(world, recordId, allLinks), options.correct);
    const providers = new Map(world.providers.map((p) => [p.id, p]));
    const allowed = (providerId: string) => !options.only || options.only.has(providerId);
    let changed = false;

    const linkOf = (providerId: string) => links.find((l) => l.providerId === providerId);
    const save = (next: RecordLink) => {
        if (released.has(recordId)) return;
        const before = linkOf(next.providerId);
        if (before && JSON.stringify(before) === JSON.stringify(next)) return;
        RecordLinkRepository.save(next);
        changed = true;
    };
    const event = (kind: ActivityKind, level: ActivityLevel, providerId: string, data: RecordData | null, extra: Record<string, unknown> = {}) =>
        ActivityService.record({
            kind,
            level,
            source: options.user ? "user" : "server",
            correlationId: options.correlationId ?? null,
            subject: { recordId, providerId },
            data: { ...facts(data, providers.get(providerId)), ...(options.user ? { user: options.user } : {}), ...extra },
        });
    const failed = (link: RecordLink, providerId: string, error: string, data: RecordData | null, action: string) => {
        if (link.status !== "error" || link.error !== error) event("record.write_failed", "error", providerId, data, { action, error });
    };

    /** Brings one provider the record goes to where the plan says. Answers where it stands then. */
    async function toTarget(step: Exclude<Step, { kind: "delete" | "forget" }>): Promise<LinkStatus> {
        const { providerId } = step;
        const link = linkOf(providerId) ?? blank(recordId, providerId);
        const now = new Date().toISOString();
        // A step to a provider exists only for a record that is there.
        const data = dataFor(desired!, providerId);
        switch (step.kind) {
            case "keep": {
                const status = step.status;
                if (link.status === "in_sync" && status !== "in_sync") {
                    event("record.drift", "warning", providerId, link.written, {
                        change: status === "missing" ? "missing" : step.observed?.disabled ? "disabled" : "changed",
                        observed: describeObserved(step.observed),
                    });
                }
                save({ ...link, status, observed: step.observed, error: null, attempts: 0 });
                return status;
            }
            case "adopt":
                save({
                    ...link,
                    zoneId: step.entry.zoneId,
                    externalId: step.entry.externalId,
                    written: data,
                    status: "in_sync",
                    error: null,
                    observed: null,
                    attempts: 0,
                    syncedAt: now,
                });
                return "in_sync";
            case "blocked":
                save({ ...link, status: "pending", error: step.reason });
                return "pending";
            case "conflict":
                failed(link, providerId, step.reason, data, "created");
                save({ ...link, status: "error", error: step.reason, lastAttemptAt: now });
                return "error";
            case "create":
            case "update":
            case "replace": {
                if (!allowed(providerId)) return link.status === "error" ? "error" : "pending";
                const provider = providers.get(providerId)!;
                try {
                    const entry = await queueFor(providerId, () => write(provider, step, data));
                    if (step.kind !== "replace" && step.correcting) {
                        event("record.corrected", "info", providerId, data, options.auto ? { auto: true } : {});
                    } else {
                        event("record.written", link.status === "error" ? "info" : "trace", providerId, data, {
                            action: step.kind === "create" ? "created" : "updated",
                        });
                    }
                    save({
                        ...link,
                        zoneId: entry.zoneId,
                        externalId: entry.externalId,
                        written: data,
                        status: "in_sync",
                        error: null,
                        observed: null,
                        attempts: 0,
                        lastAttemptAt: now,
                        syncedAt: now,
                    });
                    return "in_sync";
                } catch (err) {
                    const error = message(err);
                    logger.warn({ provider: provider.name, record: data.name, error }, "Writing a record failed");
                    failed(link, providerId, error, data, step.kind === "create" ? "created" : "updated");
                    save({ ...link, status: "error", error, attempts: link.attempts + 1, lastAttemptAt: now });
                    return "error";
                }
            }
        }
    }

    const isRemoval = (step: Step): step is Extract<Step, { kind: "delete" | "forget" | "blocked" }> =>
        step.kind === "delete" || step.kind === "forget" || (step.kind === "blocked" && step.removing);
    const toTargets = steps.filter((s): s is Exclude<Step, { kind: "delete" | "forget" }> => !isRemoval(s));
    const outcome = await Promise.all(toTargets.map(async (step) => ({ providerId: step.providerId, status: await toTarget(step) })));
    const waitingFor = outcome.filter((o) => o.status !== "in_sync" && o.status !== "drift").map((o) => providers.get(o.providerId)?.name ?? o.providerId);

    for (const step of steps.filter(isRemoval)) {
        const { providerId } = step;
        const link = linkOf(providerId)!;
        const now = new Date().toISOString();
        if (step.kind === "forget") {
            RecordLinkRepository.delete(recordId, providerId);
            changed = true;
        } else if (step.kind === "blocked") {
            save({ ...link, status: "removing", error: step.reason });
        } else if (desired && waitingFor.length > 0) {
            save({ ...link, status: "removing", error: `Waits until the record is in place at ${waitingFor.join(", ")}` });
        } else if (!allowed(providerId)) {
            if (link.status !== "removing") save({ ...link, status: "removing", error: null });
        } else {
            const provider = providers.get(providerId)!;
            try {
                await queueFor(providerId, () =>
                    withClient(provider, async (client) => {
                        await client.delete(step.target);
                        ProviderReadService.patch(providerId, { remove: step.target.externalId });
                    }),
                );
                RecordLinkRepository.delete(recordId, providerId);
                changed = true;
                event("record.written", link.error ? "info" : "trace", providerId, link.written, { action: "deleted" });
            } catch (err) {
                const error = message(err);
                logger.warn({ provider: provider.name, record: link.written?.name, error }, "Removing a record failed");
                if (link.error !== error) event("record.write_failed", "error", providerId, link.written, { action: "deleted", error });
                save({ ...link, status: "removing", error, attempts: link.attempts + 1, lastAttemptAt: now });
            }
        }
    }
    return changed;
}

/** Runs `work` with a client of the provider, and closes it after. */
async function withClient<T>(provider: Provider, work: (client: DnsProviderClient) => Promise<T>): Promise<T> {
    const stored = ProviderRepository.storedSecret(provider.id);
    if (!stored) throw new Error("The provider has no stored secret");
    const client = clientFor(provider, decryptSecret(stored));
    try {
        return await work(client);
    } finally {
        await client.close();
    }
}

/** Does one write at a provider -- in its queue, by the caller -- and keeps its last reading true to it. */
function write(provider: Provider, step: Extract<Step, { kind: "create" | "update" | "replace" }>, record: RecordData): Promise<ProviderEntry> {
    return withClient(provider, async (client) => {
        let entry: ProviderEntry;
        if (step.kind === "update") {
            entry = await client.update(step.target, record);
            ProviderReadService.patch(provider.id, { remove: step.target.externalId });
        } else {
            if (step.kind === "replace") {
                await client.delete(step.target);
                ProviderReadService.patch(provider.id, { remove: step.target.externalId });
            }
            entry = await client.create(step.zone, record);
        }
        ProviderReadService.patch(provider.id, { add: entry });
        return entry;
    });
}

/** Tells the dashboards which records to read again. */
function announce(recordIds: readonly string[]): void {
    if (recordIds.length === 0) return;
    DashboardService.broadcastToDashboard({ type: WS_EVENTS.RECORDS_UPDATE, payload: { recordIds: [...recordIds] } });
}

/** A step as the editor's preview shows it; a link dropped without touching the provider is not shown. */
function stepView(step: Step): SyncStepView | null {
    const { providerId } = step;
    switch (step.kind) {
        case "create":
            return { providerId, action: "create", reason: null };
        case "update":
            return { providerId, action: "update", reason: null };
        case "replace":
            return { providerId, action: "update", reason: `Moves into the zone ${step.zone?.name ?? "?"}` };
        case "adopt":
            return { providerId, action: "adopt", reason: "Holds it already" };
        case "keep":
            return {
                providerId,
                action: "none",
                reason: step.status === "drift" ? "Holds another value" : step.status === "missing" ? "Does not hold it any more" : null,
            };
        case "delete":
            return { providerId, action: "delete", reason: null };
        case "blocked":
            return { providerId, action: "blocked", reason: step.reason };
        case "conflict":
            return { providerId, action: "conflict", reason: step.reason };
        case "forget":
            return null;
    }
}

/** A link as the record list shows it. */
const linkView = (link: RecordLink): RecordLinkView => ({
    providerId: link.providerId,
    status: link.status,
    error: link.error,
    observed: link.observed && {
        name: link.observed.name,
        value: link.observed.value,
        ttl: link.observed.ttl,
        proxied: link.observed.proxied,
        disabled: link.observed.disabled,
    },
    syncedAt: link.syncedAt,
});

/** Brings the records to their providers one after another, and tells the dashboards which changed. */
async function syncMany(ids: readonly string[], options: SyncOptions): Promise<void> {
    const world = loadWorld();
    const changed: string[] = [];
    for (const id of ids) {
        underway.set(id, (underway.get(id) ?? 0) + 1);
        try {
            if (await syncOne(id, world, options)) changed.push(id);
        } catch (err) {
            logger.error({ err, recordId: id }, "Bringing a record to its providers failed");
        } finally {
            const left = underway.get(id)! - 1;
            if (left > 0) {
                underway.set(id, left);
            } else {
                underway.delete(id);
                released.delete(id);
            }
        }
    }
    announce(changed);
}

/**
 * Bringing the records to their providers: writing what dpm holds, comparing what the
 * providers hold, removing what no longer goes there.
 */
export class SyncService {
    /** Writes one record to its providers now, and answers once it is done. */
    static syncRecord(id: string, options: SyncOptions = {}): Promise<void> {
        return syncMany([id], options);
    }

    /** Writes several records one after another, in the background. */
    static syncSoon(ids: readonly string[], options: SyncOptions = {}): void {
        if (ids.length === 0) return;
        void syncMany(ids, options).catch((err) => logger.error({ err }, "Bringing records to their providers failed"));
    }

    /**
     * After a reading of one provider: every record compared with what it holds now -- drift
     * found, failed writes tried again, what has to go there written, what has to leave it
     * removed. Only this provider is written to; with `autoCorrect`, drift is written over.
     */
    static async afterReading(providerId: string): Promise<void> {
        const provider = ProviderRepository.findById(providerId);
        if (!provider) return;
        const ids = new Set(RecordRepository.findAll().map((r) => r.id));
        for (const link of RecordLinkRepository.findOrphans()) ids.add(link.recordId);
        await syncMany([...ids], {
            only: new Set([providerId]),
            correct: provider.autoCorrect && provider.writable ? new Set([providerId]) : undefined,
            auto: true,
        });
    }

    /**
     * What saving `fields` as the record `id` (or a new one) would do at each provider, or
     * what deleting `id` would do (`fields` null). Writes nothing.
     */
    static preview(fields: Pick<RecordFields, "name" | "type" | "value" | "settings" | "siteIds"> | null, id?: string): RecordPreview {
        const world = loadWorld();
        const allLinks = RecordLinkRepository.findAll();
        const links = id ? allLinks.filter((l) => l.recordId === id) : [];
        const routed = fields ? targetsOf(fields, world) : { targets: [], skipped: [], refusal: null };
        const steps = planRecord(fields && desiredOf(fields), routed.targets, links, planContext(world, id, allLinks));
        const conflict = routed.refusal ?? steps.find((s): s is Extract<Step, { kind: "conflict" }> => s.kind === "conflict")?.reason ?? null;
        return {
            conflict,
            steps: steps.map(stepView).filter((s): s is SyncStepView => s !== null),
            skipped: routed.skipped,
        };
    }

    /**
     * What saving a site with these providers would do: per provider, how many of the site's
     * records would be written there, and how many removed.
     */
    static previewSite(id: string | undefined, fields: SiteFields): SitePreview {
        if (!id) return [];
        const world = loadWorld();
        const changedWorld: World = {
            providers: world.providers,
            sites: world.sites.map((s) => (s.id === id ? { ...s, providerIds: fields.providerIds } : s)),
        };
        const allLinks = RecordLinkRepository.findAll();
        const writable = new Set(world.providers.filter((p) => p.writable).map((p) => p.id));
        const counts = new Map<string, { create: number; delete: number }>();
        const count = (providerId: string, key: "create" | "delete") => {
            const entry = counts.get(providerId) ?? { create: 0, delete: 0 };
            entry[key]++;
            counts.set(providerId, entry);
        };
        for (const record of RecordRepository.findAll().filter((r) => r.siteIds.includes(id))) {
            const links = allLinks.filter((l) => l.recordId === record.id);
            const steps = planRecord(desiredOf(record), targetsOf(record, changedWorld).targets, links, planContext(world, record.id, allLinks));
            for (const step of steps) {
                if (step.kind === "create" || (step.kind === "blocked" && !step.removing && writable.has(step.providerId))) {
                    count(step.providerId, "create");
                }
                if (step.kind === "delete") count(step.providerId, "delete");
            }
        }
        return [...counts].map(([providerId, c]) => ({ providerId, ...c }));
    }

    /**
     * The records as the API shows them: where each stands at its providers. A provider the
     * record goes to without a link yet is `pending`.
     */
    static views(records: readonly StoredRecord[]): DnsRecord[] {
        const world = loadWorld();
        const known = new Set(world.providers.map((p) => p.id));
        const byRecord = new Map<string, RecordLink[]>();
        for (const link of RecordLinkRepository.findAll()) {
            byRecord.set(link.recordId, [...(byRecord.get(link.recordId) ?? []), link]);
        }
        return records.map((record) => {
            const links = (byRecord.get(record.id) ?? []).filter((l) => known.has(l.providerId));
            const { targets, skipped } = targetsOf(record, world);
            const views = links.map(linkView);
            for (const target of targets) {
                if (!links.some((l) => l.providerId === target.providerId)) {
                    views.push({ providerId: target.providerId, status: "pending", error: null, observed: null, syncedAt: null });
                }
            }
            return { ...record, links: views, skipped };
        });
    }

    static view(id: string): DnsRecord | undefined {
        const record = RecordRepository.findById(id);
        return record && this.views([record])[0];
    }

    /**
     * Gives the record up: it and its links are deleted, and no provider is touched. What the
     * providers hold of it stays there, unmanaged from then on. A sync of it under way saves
     * nothing more.
     */
    static release(id: string): void {
        if (underway.has(id)) released.add(id);
        // The links go first: a record gone and its links left would be removed at the providers.
        RecordLinkRepository.deleteByRecord(id);
        RecordRepository.delete(id);
        announce([id]);
    }

    /** Deleted records a provider still holds, because removing them there has not worked yet. */
    static removals(): PendingRemoval[] {
        return RecordLinkRepository.findOrphans()
            .filter((link) => link.written !== null)
            .map((link) => ({
                providerId: link.providerId,
                name: link.written!.name,
                type: link.written!.type,
                value: link.written!.value,
                error: link.error,
            }));
    }
}
