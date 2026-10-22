import { randomUUID } from "crypto";
import { PROVIDER_TYPE_LABELS, providerSecretMissing, type Provider, type ProviderFields } from "@dpm/shared";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ProviderZoneRepository } from "../repositories/ProviderZoneRepository.js";
import { ProviderReadService } from "./ProviderReadService.js";
import { ActivityService } from "./ActivityService.js";
import { RequestError } from "./RequestError.js";
import { encryptSecret } from "./SecretCrypto.js";
import { fieldChanges } from "./changes.js";

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
                "self-signed certificates": provider.allowSelfSigned ? "accepted" : "refused",
            };
        case "samba-ad":
            return {
                ...common,
                servers: provider.servers.join(", "),
                user: provider.username,
                "self-signed certificates": provider.allowSelfSigned ? "accepted" : "refused",
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

/** The names of zones by id, as one provider's last reading knows them. */
const zoneNamesOf = (provider: Provider | undefined) => (ids: string[]) =>
    ids.length === 0 ? "–" : ids.map((id) => provider?.zones.find((z) => z.id === id)?.name ?? id).sort().join(", ");

/**
 * The providers: one access each to a DNS server dpm writes to. Their secret is encrypted
 * here, before anything stores it, and never returned.
 */
export class ProviderService {
    static create(fields: ProviderFields, user: string): Provider {
        const missing = providerSecretMissing(fields);
        if (missing) throw new RequestError(400, missing);
        checkName(fields);
        const id = randomUUID();
        ProviderRepository.create(id, fields, encryptSecret(fields.secret!));
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

    /** The provider leaves every site it was in. */
    static delete(id: string, user: string): void {
        const provider = ProviderRepository.findById(id);
        if (!provider) throw new RequestError(404, "Provider not found");
        ProviderRepository.delete(id);
        ProviderReadService.forget(id);
        ActivityService.record({
            kind: "provider.deleted",
            level: "info",
            source: "user",
            subject: { providerId: id },
            data: { user, name: provider.name, providerType: provider.type },
        });
    }
}
