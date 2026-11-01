import { randomUUID } from "crypto";
import {
    CONFIG_AREA_LABELS,
    PROVIDER_TYPE_LABELS,
    WS_EVENTS,
    adguardAddressKey,
    providerSecretMissing,
    type Provider,
    type ProviderFields,
} from "@dpm/shared";
import { ClusterRepository, type StoredNode } from "../repositories/ClusterRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ProviderZoneRepository } from "../repositories/ProviderZoneRepository.js";
import { ProviderReadService } from "./ProviderReadService.js";
import { ActivityService } from "./ActivityService.js";
import { RequestError } from "./RequestError.js";
import { encryptSecret } from "./SecretCrypto.js";
import { DashboardService } from "./DashboardService.js";
import { fieldChanges, nameList, type FieldChange } from "./changes.js";

type ClusterFields = Extract<ProviderFields, { type: "adguard-cluster" }>;
type ClusterProvider = Extract<Provider, { type: "adguard-cluster" }>;

const certificates = (accepted: boolean) => (accepted ? "accepted" : "refused");

/** A provider as a reader of the activity would describe it. The secret is never part of it. */
function describe(provider: ProviderFields | Provider, zoneNames: (ids: string[]) => string): Record<string, string> {
    const common = {
        name: provider.name,
        "auto-correct": provider.autoCorrect ? "on" : "off",
        "read only": provider.readOnly ? "on" : "off",
    };
    switch (provider.type) {
        case "cloudflare":
            return {
                ...common,
                zones: provider.zoneMode === "all" ? "all" : "selected",
                "selected zones": zoneNames(provider.zoneIds),
            };
        case "adguard":
            return {
                ...common,
                url: provider.url,
                user: provider.username,
                "self-signed certificates": certificates(provider.allowSelfSigned),
            };
        case "adguard-cluster": {
            const description: Record<string, string> = {
                ...common,
                nodes: nameList(provider.nodes.map((n) => n.name)),
                primary: provider.nodes.find((n) => n.primary)?.name ?? "–",
                "kept alike": provider.areas.map((a) => CONFIG_AREA_LABELS[a]).join(", "),
            };
            for (const node of provider.nodes) {
                description[`node ${node.name}`] = `${node.url}, user ${node.username}, self-signed certificates ${certificates(node.allowSelfSigned)}`;
            }
            return description;
        }
        case "samba-ad":
            return {
                ...common,
                servers: provider.servers.join(", "),
                user: provider.username,
                "self-signed certificates": certificates(provider.allowSelfSigned),
            };
    }
}

function checkName(fields: ProviderFields, exceptId?: string): void {
    if (ProviderRepository.nameTaken(fields.name, exceptId)) {
        throw new RequestError(409, `A provider named "${fields.name}" exists already`);
    }
}

/**
 * Refuses to tick a zone that another provider has ticked under "Selected zones": two
 * explicit choices of one zone cannot both stand. A zone another provider merely sees is
 * taken over by ticking it here.
 */
function checkZones(id: string, fields: ProviderFields): void {
    if (fields.type !== "cloudflare" || fields.zoneMode !== "selected") return;
    for (const other of ProviderRepository.findAll()) {
        if (other.id === id || other.type !== "cloudflare" || other.zoneMode !== "selected") continue;
        const clash = other.zones.find((z) => z.selected && fields.zoneIds.includes(z.id));
        if (clash) throw new RequestError(409, `The zone ${clash.name} is chosen for the provider "${other.name}" already`);
    }
}

/**
 * Refuses a node of a cluster at an AdGuard Home address dpm reaches already, as a provider of
 * its own or as a node of another cluster: the cluster's run would write over the other's
 * changes there on every run. Two single providers at one address are left as they were.
 */
function checkAddresses(id: string | undefined, fields: ProviderFields): void {
    const wanted = fields.type === "adguard" ? [fields.url] : fields.type === "adguard-cluster" ? fields.nodes.map((n) => n.url) : [];
    if (wanted.length === 0) return;
    const taken = new Map<string, string>();
    for (const other of ProviderRepository.findAll()) {
        if (other.id === id) continue;
        if (other.type === "adguard" && fields.type === "adguard-cluster") taken.set(adguardAddressKey(other.url), `the provider "${other.name}"`);
        if (other.type === "adguard-cluster") {
            for (const node of other.nodes) taken.set(adguardAddressKey(node.url), `the node ${node.name} of the cluster "${other.name}"`);
        }
    }
    for (const url of wanted) {
        const owner = taken.get(adguardAddressKey(url));
        if (owner) throw new RequestError(409, `${url} is the address of ${owner} already`);
    }
}

/**
 * The nodes of a cluster as they are stored: a node of this cluster keeps its id, any other
 * gets a new one; a password typed is encrypted, none keeps the stored one. A node new to the
 * cluster without a password is refused.
 */
function storedNodes(fields: ClusterFields, before: ClusterProvider | undefined): StoredNode[] {
    const known = new Set(before?.nodes.map((n) => n.id) ?? []);
    return fields.nodes.map((node) => {
        const id = node.id && known.has(node.id) ? node.id : randomUUID();
        if (!known.has(id) && !node.secret) throw new RequestError(400, `Enter the password of ${node.name}`);
        return {
            id,
            name: node.name,
            url: node.url,
            username: node.username,
            allowSelfSigned: node.allowSelfSigned,
            primary: node.primary,
            secret: node.secret ? encryptSecret(node.secret) : undefined,
        };
    });
}

const broadcastCluster = (providerId: string) =>
    DashboardService.broadcastToDashboard({ type: WS_EVENTS.CLUSTER_UPDATE, payload: { providerId } });

/** The names of zones by id, as one provider's last reading knows them. */
const zoneNamesOf = (provider: Provider | undefined) => (ids: string[]) =>
    ids.length === 0 ? "–" : ids.map((id) => provider?.zones.find((z) => z.id === id)?.name ?? id).sort().join(", ");

/**
 * The providers: one access each to a DNS server dpm writes to. Their secret is encrypted
 * here, before anything stores it, and never returned.
 */
export class ProviderService {
    static create(fields: ProviderFields, user: string): Provider {
        // The nodes of a new cluster are all new, whatever ids came with them.
        if (fields.type === "adguard-cluster") fields = { ...fields, nodes: fields.nodes.map((n) => ({ ...n, id: undefined })) };
        const missing = providerSecretMissing(fields);
        if (missing) throw new RequestError(400, missing);
        checkName(fields);
        checkAddresses(undefined, fields);
        const id = randomUUID();
        if (fields.type === "adguard-cluster") {
            const cluster = fields;
            const nodes = storedNodes(cluster, undefined);
            ProviderRepository.inTransaction(() => {
                ProviderRepository.create(id, cluster, null);
                ClusterRepository.save(id, cluster.areas, nodes);
            });
            broadcastCluster(id);
        } else {
            ProviderRepository.create(id, fields, encryptSecret(fields.secret!));
        }
        ProviderReadService.readSoon(id);
        ActivityService.record({
            kind: "provider.created",
            level: "info",
            source: "user",
            subject: { providerId: id },
            data: { user, name: fields.name, providerType: fields.type },
        });
        return ProviderRepository.findById(id)!;
    }

    /** The type is fixed: a Cloudflare token does not turn into an AdGuard Home instance. */
    static update(id: string, fields: ProviderFields, user: string): Provider {
        const before = ProviderRepository.findById(id);
        if (!before) throw new RequestError(404, "Provider not found");
        if (before.type !== fields.type) {
            throw new RequestError(
                400,
                `A ${PROVIDER_TYPE_LABELS[before.type]} provider cannot become a ${PROVIDER_TYPE_LABELS[fields.type]} provider`,
            );
        }
        checkName(fields, id);
        checkZones(id, fields);
        checkAddresses(id, fields);
        if (fields.type === "adguard-cluster" && before.type === "adguard-cluster") {
            return this.updateCluster(before, fields, user);
        }
        if (fields.type === "adguard-cluster") throw new RequestError(400, "Not a cluster");
        const names = zoneNamesOf(before);
        const changes = fieldChanges(describe(before, names), describe(fields, names));
        // Named as changed, never shown: the event says that it was replaced, not with what.
        if (fields.secret) changes.push({ field: "secret", from: "stored", to: "replaced" });
        ProviderRepository.update(id, fields, fields.secret ? encryptSecret(fields.secret) : undefined);
        if (fields.type === "cloudflare") ProviderZoneRepository.setSelected(id, fields.zoneIds);
        // What it reaches may have changed with the token, the address or the zones.
        if (changes.length > 0) ProviderReadService.readSoon(id);
        if (changes.length > 0) {
            ActivityService.record({
                kind: "provider.changed",
                level: "info",
                source: "user",
                subject: { providerId: id },
                data: { user, name: fields.name, providerType: fields.type, changes },
            });
        }
        return ProviderRepository.findById(id)!;
    }

    /**
     * Saves a cluster with its nodes. Another primary starts the cluster over: the next run
     * writes its state to every other node without reporting what it replaces -- the editor's
     * preview showed it. A node or an area new to the cluster has nothing written yet, which
     * comes to the same. Nothing runs now: the timer or "Sync now" does.
     */
    private static updateCluster(before: ClusterProvider, fields: ClusterFields, user: string): Provider {
        const id = before.id;
        const nodes = storedNodes(fields, before);
        const after: ClusterProvider = {
            ...before,
            ...fields,
            nodes: nodes.map((n) => ({ ...n, hasSecret: true, version: null, lastSeenAt: null, lastError: null })),
        };
        const beforePrimary = before.nodes.find((n) => n.primary) ?? null;
        const afterPrimary = nodes.find((n) => n.primary)!;
        const primaryChanged = beforePrimary?.id !== afterPrimary.id;

        const names = zoneNamesOf(before);
        const describedBefore = describe(before, names);
        const describedAfter = describe(after, names);
        // Another primary has an event of its own.
        if (primaryChanged) delete describedAfter.primary;
        const changes: FieldChange[] = fieldChanges(describedBefore, describedAfter);
        for (const node of fields.nodes) {
            if (node.secret && node.id && before.nodes.some((n) => n.id === node.id)) {
                changes.push({ field: `password of ${node.name}`, from: "stored", to: "replaced" });
            }
        }

        ProviderRepository.inTransaction(() => {
            ProviderRepository.update(id, fields, undefined);
            ClusterRepository.save(id, fields.areas, nodes);
            ClusterRepository.keepOnly(id, afterPrimary.id, fields.areas);
            if (primaryChanged) ClusterRepository.startOver(id);
        });

        if (primaryChanged) {
            ActivityService.record({
                kind: "cluster.primary_changed",
                level: "info",
                source: "user",
                subject: { providerId: id },
                data: { user, cluster: fields.name, from: beforePrimary?.name ?? null, to: afterPrimary.name },
            });
        }
        if (changes.length > 0 || primaryChanged) ProviderReadService.readSoon(id);
        if (changes.length > 0) {
            ActivityService.record({
                kind: "provider.changed",
                level: "info",
                source: "user",
                subject: { providerId: id },
                data: { user, name: fields.name, providerType: fields.type, changes },
            });
        }
        broadcastCluster(id);
        return ProviderRepository.findById(id)!;
    }

    /** The provider leaves every site it was in. */
    static delete(id: string, user: string): void {
        const provider = ProviderRepository.findById(id);
        if (!provider) throw new RequestError(404, "Provider not found");
        ProviderRepository.delete(id);
        ProviderReadService.forget(id);
        if (provider.type === "adguard-cluster") broadcastCluster(id);
        ActivityService.record({
            kind: "provider.deleted",
            level: "info",
            source: "user",
            subject: { providerId: id },
            data: { user, name: provider.name, providerType: provider.type },
        });
    }
}
