import { PROVIDER_TYPE_LABELS, type ProviderType } from "@dpm/shared";
import {
    CAPABILITIES,
    type EntryRef,
    type ProviderCapabilities,
    type ProviderEntry,
    type ProviderZoneInfo,
    type RecordData,
} from "../providers/DnsProvider.js";
import type { Observed, RecordLink } from "../repositories/RecordLinkRepository.js";
import type { Target } from "./recordTargets.js";

/** What the plan needs of a provider. */
export interface PlanProvider {
    id: string;
    name: string;
    type: ProviderType;
    readOnly: boolean;
    writable: boolean;
}

export interface PlanContext {
    providers: ReadonlyMap<string, PlanProvider>;
    /** Each provider's last reading, disabled entries included. No entry: never read. */
    readings: ReadonlyMap<string, readonly ProviderEntry[]>;
    /** `claimKey`s of the entries other records hold, or have drifted to. */
    claimed: ReadonlySet<string>;
}

/** What one step does at one provider. */
export type Step =
    /** Writes the record anew, into `zone`. `correcting`: what was there drifted, and dpm's value goes back. */
    | { kind: "create"; providerId: string; zone: ProviderZoneInfo | null; correcting?: true }
    /** Writes the record over the entry `target`, which the link holds from then on. */
    | { kind: "update"; providerId: string; target: EntryRef; correcting?: true }
    /** Removes `target` and writes the record anew into `zone`: its name moved to another zone. */
    | { kind: "replace"; providerId: string; target: EntryRef; zone: ProviderZoneInfo | null }
    /** The provider holds the record already: the link takes the entry, nothing is written. */
    | { kind: "adopt"; providerId: string; entry: ProviderEntry }
    /** Nothing to write. Where the record stands there, as the last reading says. */
    | { kind: "keep"; providerId: string; status: "in_sync" | "drift" | "missing"; observed: Observed | null }
    /** Removes the entry: the record was deleted, or does not go to this provider any more. */
    | { kind: "delete"; providerId: string; target: EntryRef }
    /** Drops the link without touching the provider: nothing was written there, or it stays in dpm's hands otherwise. */
    | { kind: "forget"; providerId: string }
    /** Would write or remove, but must not, or cannot yet. */
    | { kind: "blocked"; providerId: string; reason: string; removing: boolean }
    /** Refused: the provider holds something the record cannot stand beside. */
    | { kind: "conflict"; providerId: string; reason: string };

/** How a link and the entries it is matched against are told apart: per provider. */
export const claimKey = (providerId: string, externalId: string) => `${providerId}\u0000${externalId}`;

/**
 * Whether the provider holds `b` as `a` -- in what it knows. A TTL is not compared while
 * Cloudflare proxies the record: Cloudflare sets it to "Auto" then, whatever was written.
 */
export function sameAtProvider(a: RecordData, b: RecordData, caps: ProviderCapabilities): boolean {
    if (a.name !== b.name || a.type !== b.type || a.value !== b.value) return false;
    if (caps.proxied && a.proxied !== b.proxied) return false;
    if (caps.ttl && !(caps.proxied && (a.proxied || b.proxied)) && a.ttl !== b.ttl) return false;
    return true;
}

const refOf = (link: Pick<RecordLink, "externalId" | "zoneId">, zone: string | null): EntryRef => ({
    externalId: link.externalId!,
    zoneId: link.zoneId,
    zone,
});

const observedOf = (entry: ProviderEntry): Observed => ({
    externalId: entry.externalId,
    name: entry.name,
    value: entry.value,
    ttl: entry.ttl,
    proxied: entry.proxied,
    disabled: entry.disabled,
});

/** Why dpm does not write to this provider. */
function notWritable(provider: PlanProvider): string {
    return provider.readOnly ? "Read only" : `Writing to ${PROVIDER_TYPE_LABELS[provider.type]} comes with a later version`;
}

/**
 * Where a record dpm wrote stands at the provider, from its last reading:
 *
 * - found as written -- `in_sync`; found otherwise, or switched off -- `drift`;
 * - not found -- `missing`, unless exactly one entry of its name and type is there that no
 *   record holds: then it was changed rather than deleted. AdGuard Home tells a rewrite by its
 *   answer, so a changed answer reads as a rewrite gone and another one come.
 */
export function observe(
    link: RecordLink,
    entries: readonly ProviderEntry[] | undefined,
    providerId: string,
    claimed: ReadonlySet<string>,
    caps: ProviderCapabilities,
): { status: "in_sync" | "drift" | "missing"; observed: Observed | null } {
    // Never read since the server started: as last known.
    if (entries === undefined) {
        return link.status === "drift" || link.status === "missing"
            ? { status: link.status, observed: link.observed }
            : { status: "in_sync", observed: null };
    }
    const current = entries.find((e) => e.externalId === link.externalId);
    if (current) {
        if (current.disabled || (link.written && !sameAtProvider(link.written, current, caps))) {
            return { status: "drift", observed: observedOf(current) };
        }
        return { status: "in_sync", observed: null };
    }
    if (link.written) {
        const { name, type } = link.written;
        const candidates = entries.filter(
            (e) =>
                e.name === name &&
                e.type === type &&
                (link.zoneId === null || e.zoneId === link.zoneId) &&
                !claimed.has(claimKey(providerId, e.externalId)),
        );
        if (candidates.length === 1) return { status: "drift", observed: observedOf(candidates[0]) };
    }
    return { status: "missing", observed: null };
}

/**
 * Why the provider cannot take `record` beside what it holds, or null. Only entries no other
 * record holds count: between records, `recordConflict` decided before. A CNAME stands alone
 * at its name, whatever the type of the other entry.
 */
function conflictAt(
    record: RecordData,
    provider: PlanProvider,
    entries: readonly ProviderEntry[] | undefined,
    claimed: ReadonlySet<string>,
    own: ReadonlySet<string>,
): string | null {
    for (const entry of entries ?? []) {
        if (entry.disabled || entry.name !== record.name || own.has(entry.externalId)) continue;
        if (claimed.has(claimKey(provider.id, entry.externalId))) continue;
        if (record.type !== "CNAME" && entry.type !== "CNAME") continue;
        if (entry.type === record.type && entry.value === record.value) continue;
        const held = entry.type === "CNAME" ? `a CNAME to ${entry.value}` : `an ${entry.type} record`;
        return `${provider.name} holds ${held} for ${record.name} that dpm does not manage, and a CNAME cannot stand beside another record of its name. Adopt it or remove it there first.`;
    }
    return null;
}

/**
 * What it takes to bring one record to its providers, one step per provider. Pure: it looks
 * at what dpm holds, the last readings and the links, and says what to do -- `SyncService`
 * does it.
 *
 * - `desired` is the record as dpm holds it, or null for a record that was deleted.
 * - A record changed in dpm (other than what the link says was written) is written again;
 *   one changed at the provider is `drift` and left alone, unless the provider is in
 *   `correct` -- then dpm's value is written over it.
 * - A provider that holds the record already, unclaimed, gets no second one: its entry is
 *   taken over. AdGuard Home would add a duplicate.
 * - Where the provider was never read, nothing is written for a record it has no entry of yet.
 * - Removals come last, for links of providers the record no longer goes to. One whose entry
 *   another provider of the record holds too -- two API tokens that see the same zone -- is
 *   dropped instead: deleting it would delete the record there.
 */
export function planRecord(
    desired: RecordData | null,
    targets: readonly Target[],
    links: readonly RecordLink[],
    context: PlanContext,
    correct: ReadonlySet<string> = new Set(),
): Step[] {
    const steps: Step[] = [];
    const targetIds = new Set(desired ? targets.map((t) => t.providerId) : []);

    for (const target of desired ? targets : []) {
        const provider = context.providers.get(target.providerId);
        if (!provider) continue;
        steps.push(planTarget(desired!, target, provider, links.find((l) => l.providerId === provider.id), context, correct));
    }

    const targetSteps = [...steps];
    /** Whether a provider the record goes to holds this very entry: the same zone, the same id. */
    const keptElsewhere = (link: RecordLink) =>
        link.zoneId !== null &&
        targetSteps.some((step) => {
            if (step.kind === "adopt") return step.entry.zoneId === link.zoneId && step.entry.externalId === link.externalId;
            const other = links.find((o) => o.providerId === step.providerId);
            return other?.zoneId === link.zoneId && other?.externalId === link.externalId;
        });

    for (const link of links) {
        if (targetIds.has(link.providerId)) continue;
        const provider = context.providers.get(link.providerId);
        if (!provider) continue;
        if (link.externalId === null || keptElsewhere(link)) {
            steps.push({ kind: "forget", providerId: link.providerId });
        } else if (!provider.writable) {
            steps.push({ kind: "blocked", providerId: link.providerId, reason: notWritable(provider), removing: true });
        } else {
            steps.push({ kind: "delete", providerId: link.providerId, target: refOf(link, null) });
        }
    }
    return steps;
}

function planTarget(
    desired: RecordData,
    target: Target,
    provider: PlanProvider,
    link: RecordLink | undefined,
    context: PlanContext,
    correct: ReadonlySet<string>,
): Step {
    const caps = CAPABILITIES[provider.type];
    const entries = context.readings.get(provider.id);
    const providerId = provider.id;
    const write = (step: Step): Step =>
        provider.writable ? step : { kind: "blocked", providerId, reason: notWritable(provider), removing: false };
    const own = new Set([link?.externalId, link?.observed?.externalId].filter((id): id is string => !!id));
    const conflict = () => {
        const reason = conflictAt(desired, provider, entries, context.claimed, own);
        return reason ? ({ kind: "conflict", providerId, reason } as const) : null;
    };
    const zoneName = target.zone?.name ?? null;

    if (link?.externalId) {
        const zoneMoved = caps.zoned && link.zoneId !== (target.zone?.id ?? null);
        const current = entries === undefined ? undefined : (entries.find((e) => e.externalId === link.externalId) ?? null);
        if (!link.written || zoneMoved || !sameAtProvider(desired, link.written, caps)) {
            const refused = conflict();
            if (refused) return refused;
            if (current === null) {
                // Gone, or changed there into an entry of another id (AdGuard Home): that one
                // is what the record's new value goes over, rather than a second entry beside it.
                const seen = observe(link, entries, providerId, context.claimed, caps);
                if (seen.observed) {
                    return write({ kind: "update", providerId, target: { externalId: seen.observed.externalId, zoneId: link.zoneId, zone: zoneName } });
                }
                return write({ kind: "create", providerId, zone: target.zone });
            }
            if (zoneMoved) return write({ kind: "replace", providerId, target: refOf(link, null), zone: target.zone });
            return write({ kind: "update", providerId, target: refOf(link, zoneName) });
        }
        const seen = observe(link, entries, providerId, context.claimed, caps);
        if (seen.status !== "in_sync" && correct.has(providerId)) {
            if (seen.status === "missing") return write({ kind: "create", providerId, zone: target.zone, correcting: true });
            // What the provider holds now -- for AdGuard Home a rewrite with another answer, and so another id.
            const held = { externalId: seen.observed?.externalId ?? link.externalId, zoneId: link.zoneId, zone: zoneName };
            return write({ kind: "update", providerId, target: held, correcting: true });
        }
        return { kind: "keep", providerId, status: seen.status, observed: seen.observed };
    }

    if (entries === undefined) {
        return { kind: "blocked", providerId, reason: "Not read yet: written once dpm knows what it holds", removing: false };
    }
    const refused = conflict();
    if (refused) return refused;
    const found = entries.find(
        (e) =>
            !e.disabled &&
            e.name === desired.name &&
            e.type === desired.type &&
            e.value === desired.value &&
            (target.zone === null || e.zoneId === target.zone.id) &&
            !context.claimed.has(claimKey(providerId, e.externalId)),
    );
    if (found) {
        return sameAtProvider(desired, found, caps)
            ? { kind: "adopt", providerId, entry: found }
            : write({ kind: "update", providerId, target: { externalId: found.externalId, zoneId: found.zoneId, zone: found.zone } });
    }
    return write({ kind: "create", providerId, zone: target.zone });
}
