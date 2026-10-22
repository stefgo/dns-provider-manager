import {
    WS_EVENTS,
    type ProviderFields,
    type ProviderTestResult,
    type Reading,
    type SchedulerStatus,
    type SchedulerTrigger,
} from "@dpm/shared";
import { logger } from "@dpm/shared/node";
import { appConfig } from "../config/AppConfig.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ProviderZoneRepository } from "../repositories/ProviderZoneRepository.js";
import type { ProviderEntry } from "../providers/DnsProvider.js";
import { clientFor } from "../providers/clients.js";
import { ActivityService } from "./ActivityService.js";
import { DashboardService } from "./DashboardService.js";
import { ScheduledJob } from "./ScheduledJob.js";
import { decryptSecret } from "./SecretCrypto.js";
import { RequestError } from "./RequestError.js";
import { queueFor } from "./providerQueue.js";
import { SyncService } from "./SyncService.js";

/**
 * What the last reading of a provider found -- switched-off AdGuard Home rewrites included --
 * and what dpm wrote there since. Kept in memory: a restart reads again.
 */
interface ReadingState {
    readAt: string | null;
    error: string | null;
    entries: ProviderEntry[];
}

const readings = new Map<string, ReadingState>();

/** A reading under way, per provider: a second request waits for the same one. */
const inFlight = new Map<string, Promise<boolean>>();

const intervalMinutes = () => {
    const minutes = parseInt(appConfig.settings.provider_read_interval_minutes ?? "5", 10);
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : 5;
};

const job = new ScheduledJob({
    id: "provider-read",
    intervalMs: () => intervalMinutes() * 60 * 1000,
    outcome: (result) => (result.failed > 0 ? "partial" : "success"),
});

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Reads one provider: its zones, then the records of the zones it uses. Remembers what it
 * found, says on the dashboards that it read, and reports the moment a provider stops or
 * starts answering -- not every failed reading, which would repeat itself every few minutes.
 * Resolves whether the reading succeeded; a provider this build cannot read counts as read.
 *
 * In the provider's queue: nothing writes to it meanwhile.
 */
const readProvider = (providerId: string) => queueFor(providerId, () => readNow(providerId));

async function readNow(providerId: string): Promise<boolean> {
    const provider = ProviderRepository.findById(providerId);
    if (!provider) {
        readings.delete(providerId);
        return true;
    }
    const stored = ProviderRepository.storedSecret(providerId);
    if (!stored) return true;
    const client = clientFor(provider, decryptSecret(stored));

    const now = new Date().toISOString();
    try {
        const entries: ProviderEntry[] = [];
        if (client.zoned) {
            ProviderZoneRepository.replace(providerId, await client.listZones());
            // Who uses a zone may have changed with what this reading found.
            const zones = ProviderRepository.findById(providerId)?.zones ?? [];
            for (const zone of zones.filter((z) => z.owner === providerId)) {
                entries.push(...(await client.listRecords({ id: zone.id, name: zone.name })));
            }
        } else {
            entries.push(...(await client.listRecords(null)));
        }
        readings.set(providerId, { readAt: now, error: null, entries });
        ProviderRepository.markRead(providerId, now, null);
        if (provider.lastError !== null) {
            ActivityService.record({
                kind: "provider.recovered",
                level: "info",
                subject: { providerId },
                data: { name: provider.name, providerType: provider.type },
            });
        }
        return true;
    } catch (err) {
        const error = message(err);
        const before = readings.get(providerId);
        // What the last good reading found stays: a provider that is down still holds it.
        readings.set(providerId, { readAt: before?.readAt ?? null, error, entries: before?.entries ?? [] });
        ProviderRepository.markRead(providerId, now, error);
        logger.warn({ provider: provider.name, error }, "Provider could not be read");
        if (provider.lastError === null) {
            ActivityService.record({
                kind: "provider.unreachable",
                level: "warning",
                subject: { providerId },
                data: { name: provider.name, providerType: provider.type, error },
            });
        }
        return false;
    } finally {
        await client.close();
        DashboardService.broadcastToDashboard({ type: WS_EVENTS.READINGS_UPDATE, payload: { providerId } });
    }
}

/**
 * Reading the providers: on a timer, at startup, when one is saved, and on request. Each
 * reading is followed by the comparison with the records (`SyncService.afterReading`), which
 * is where drift is found and failed writes are tried again.
 */
export class ProviderReadService {
    /**
     * Reads one provider now, or waits for the reading already under way. A reading that
     * succeeded is compared with the records -- drift, retries, what is still to be written
     * there -- before it resolves.
     */
    static read(providerId: string): Promise<boolean> {
        const running = inFlight.get(providerId);
        if (running) return running;
        const reading = readProvider(providerId)
            .then(async (ok) => {
                if (ok) {
                    await SyncService.afterReading(providerId).catch((err) =>
                        logger.error({ err, providerId }, "Comparing a provider with the records failed"),
                    );
                }
                return ok;
            })
            .finally(() => inFlight.delete(providerId));
        inFlight.set(providerId, reading);
        return reading;
    }

    /** Reads every provider, one after another, as one run of the scheduler. */
    static run(trigger: SchedulerTrigger = "schedule"): Promise<{ read: number; failed: number }> {
        return job.run(trigger, async () => {
            let read = 0;
            let failed = 0;
            for (const provider of ProviderRepository.findAll()) {
                if (!provider.readable) continue;
                if (await this.read(provider.id)) read++;
                else failed++;
            }
            return { read, failed };
        });
    }

    /** Reads in the background; a failure is reported by the reading itself. */
    static readSoon(providerId: string): void {
        void this.read(providerId).catch((err) => logger.error({ err, providerId }, "Reading a provider failed"));
    }

    /** Forgets what a deleted provider held. */
    static forget(providerId: string): void {
        readings.delete(providerId);
    }

    /**
     * The entries of the last readings, by provider, switched-off ones included. A provider
     * not read since the server started has none -- not an empty list.
     */
    static entries(): Map<string, ProviderEntry[]> {
        return new Map([...readings].filter(([, state]) => state.readAt !== null).map(([id, state]) => [id, state.entries]));
    }

    /**
     * Keeps the last reading true to what dpm just did there, so that the next step does not
     * go by what the provider held before: the entry `remove` names is gone, `add` is there.
     */
    static patch(providerId: string, change: { remove?: string; add?: ProviderEntry }): void {
        const state = readings.get(providerId);
        if (!state || state.readAt === null) return;
        const entries = state.entries.filter((e) => e.externalId !== change.remove && e.externalId !== change.add?.externalId);
        if (change.add) entries.push(change.add);
        readings.set(providerId, { ...state, entries });
    }

    /** How each provider's last reading went, for the pages that show it. */
    static readings(): Reading[] {
        return ProviderRepository.findAll().map((provider) => {
            const state = readings.get(provider.id);
            return {
                providerId: provider.id,
                providerType: provider.type,
                readAt: state?.readAt ?? null,
                error: state?.error ?? provider.lastError,
                recordCount: state?.entries.filter((e) => !e.disabled).length ?? 0,
            };
        });
    }

    /**
     * Asks a provider as the editor holds it, saved or not, whether it answers. `id` names
     * the stored provider whose secret stands in while none was typed. Changes nothing.
     */
    static async test(fields: ProviderFields, id?: string): Promise<ProviderTestResult> {
        let secret = fields.secret;
        if (!secret && id) {
            const stored = ProviderRepository.storedSecret(id);
            if (stored === null) throw new RequestError(404, "Provider not found");
            secret = decryptSecret(stored);
        }
        if (!secret) throw new RequestError(400, fields.type === "cloudflare" ? "Enter the API token" : "Enter the password");
        const client = clientFor(fields, secret);
        try {
            const zones = client.zoned ? await client.listZones() : [];
            return { ok: true, message: await client.test(), zones };
        } catch (err) {
            return { ok: false, message: message(err), zones: [] };
        } finally {
            await client.close();
        }
    }

    static startScheduler(): void {
        job.start(() => this.run("schedule"));
    }

    static stopScheduler(): void {
        job.stop();
    }

    static restartScheduler(): void {
        this.startScheduler();
    }

    static getStatus(): SchedulerStatus<"provider-read"> {
        return job.status();
    }
}
