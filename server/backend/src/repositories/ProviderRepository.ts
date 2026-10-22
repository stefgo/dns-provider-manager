import db from "../core/Database.js";
import { ZONE_MODES, type Provider, type ProviderFields, type ProviderType } from "@dpm/shared";
import { idsColumn } from "./SiteRepository.js";
import { ProviderZoneRepository, type StoredZone } from "./ProviderZoneRepository.js";
import { zoneOwnership } from "../services/zoneOwnership.js";

/** The types this build can read. The others are kept and shown, and wait for their client. */
export const READABLE_TYPES: readonly ProviderType[] = ["cloudflare"];

interface ProviderRow {
    id: string;
    type: string;
    name: string;
    settings: string;
    secret: string | null;
    auto_correct: number;
    last_seen_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string | null;
    /** Not a column: a JSON array of the sites the provider belongs to. */
    site_ids: string;
}

const SELECT_PROVIDER = `
    SELECT p.*,
        (SELECT json_group_array(site_id) FROM site_providers WHERE provider_id = p.id) AS site_ids
    FROM providers p`;

/** What a provider keeps in `settings`: everything of its input but name, secret and the switch. */
function settingsOf(fields: ProviderFields): Record<string, unknown> {
    switch (fields.type) {
        case "cloudflare":
            return { zoneMode: fields.zoneMode };
        case "adguard":
            return { url: fields.url, username: fields.username, allowSelfSigned: fields.allowSelfSigned };
        case "samba-ad":
            return { servers: fields.servers, username: fields.username, allowSelfSigned: fields.allowSelfSigned };
    }
}

function parseSettings(text: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(text);
        return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

const zoneModeOf = (settings: Record<string, unknown>): (typeof ZONE_MODES)[number] =>
    (ZONE_MODES as readonly unknown[]).includes(settings.zoneMode) ? (settings.zoneMode as (typeof ZONE_MODES)[number]) : "all";

// Only ever written from checked input, but a row edited by hand must not take the list
// down: what does not read falls back to the default of its field.
const text = (value: unknown) => (typeof value === "string" ? value : "");
const flag = (value: unknown) => value === true;

/** What the view of a provider adds from its zones: the zones, with who uses each, and the ticked ones. */
interface ZoneFacts {
    zones: Provider["zones"];
    zoneIds: string[];
}

/**
 * A row as the API shows it -- without the secret. A row of a type this build does not
 * know is left out rather than shown as something it is not.
 */
function rowToProvider(row: ProviderRow, { zones, zoneIds }: ZoneFacts): Provider | null {
    const settings = parseSettings(row.settings);
    const common = {
        id: row.id,
        name: row.name,
        autoCorrect: row.auto_correct === 1,
        hasSecret: row.secret !== null && row.secret !== "",
        siteIds: idsColumn(row.site_ids),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastSeenAt: row.last_seen_at,
        lastError: row.last_error,
        zones,
        readable: READABLE_TYPES.includes(row.type as ProviderType),
    };
    switch (row.type as ProviderType) {
        case "cloudflare":
            return {
                type: "cloudflare",
                ...common,
                zoneMode: zoneModeOf(settings),
                zoneIds,
            };
        case "adguard":
            return {
                type: "adguard",
                ...common,
                url: text(settings.url),
                username: text(settings.username),
                allowSelfSigned: flag(settings.allowSelfSigned),
            };
        case "samba-ad":
            return {
                type: "samba-ad",
                ...common,
                servers: Array.isArray(settings.servers) ? settings.servers.filter((s): s is string => typeof s === "string") : [],
                username: text(settings.username),
                allowSelfSigned: flag(settings.allowSelfSigned),
            };
        default:
            return null;
    }
}

/**
 * Each provider's zones with who uses them -- worked out across all providers at once,
 * since a zone two tokens see is decided between the two.
 */
function zoneFacts(rows: readonly ProviderRow[], zones: readonly StoredZone[]): Map<string, ZoneFacts> {
    const owners = zoneOwnership(
        rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            zoneMode: row.type === "cloudflare" ? zoneModeOf(parseSettings(row.settings)) : "all",
        })),
        zones,
    );
    return new Map(
        rows.map((row) => {
            const own = zones.filter((z) => z.providerId === row.id);
            return [
                row.id,
                {
                    zones: own.map((z) => ({ id: z.zoneId, name: z.name, selected: z.selected, owner: owners.get(z.zoneId) ?? null })),
                    zoneIds: own.filter((z) => z.selected).map((z) => z.zoneId),
                },
            ];
        }),
    );
}

export class ProviderRepository {
    static findAll(): Provider[] {
        const rows = db.prepare(`${SELECT_PROVIDER} ORDER BY p.name COLLATE NOCASE`).all() as ProviderRow[];
        const facts = zoneFacts(rows, ProviderZoneRepository.findAll());
        return rows.map((row) => rowToProvider(row, facts.get(row.id)!)).filter((p): p is Provider => p !== null);
    }

    /** Through the whole list: who uses a zone is decided among all providers. */
    static findById(id: string): Provider | undefined {
        return this.findAll().find((p) => p.id === id);
    }

    /** The stored secret, as `SecretCrypto` made it -- for the one who talks to the provider. */
    static storedSecret(id: string): string | null {
        const row = db.prepare("SELECT secret FROM providers WHERE id = ?").get(id) as { secret: string | null } | undefined;
        return row?.secret ?? null;
    }

    /** How the last reading went: when it succeeded, or why it failed (the time then stays). */
    static markRead(id: string, at: string, error: string | null): void {
        if (error === null) {
            db.prepare("UPDATE providers SET last_seen_at = ?, last_error = NULL WHERE id = ?").run(at, id);
        } else {
            db.prepare("UPDATE providers SET last_error = ? WHERE id = ?").run(error, id);
        }
    }

    /** Whether another provider than `exceptId` is called `name`, ignoring case. */
    static nameTaken(name: string, exceptId?: string): boolean {
        return (
            db.prepare("SELECT 1 FROM providers WHERE name = ? COLLATE NOCASE AND id != ?").get(name, exceptId ?? "") !==
            undefined
        );
    }

    /** `secret` is what `SecretCrypto` made of it; nothing here sees it in the clear. */
    static create(id: string, fields: ProviderFields, secret: string): void {
        db.prepare(`
            INSERT INTO providers (id, type, name, settings, secret, auto_correct, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            fields.type,
            fields.name,
            JSON.stringify(settingsOf(fields)),
            secret,
            fields.autoCorrect ? 1 : 0,
            new Date().toISOString(),
        );
    }

    /** `secret` undefined keeps the stored one. The type is not touched: it never changes. */
    static update(id: string, fields: ProviderFields, secret: string | undefined): { changes: number } {
        return db.prepare(`
            UPDATE providers
            SET name = ?, settings = ?, auto_correct = ?, secret = COALESCE(?, secret), updated_at = ?
            WHERE id = ?
        `).run(
            fields.name,
            JSON.stringify(settingsOf(fields)),
            fields.autoCorrect ? 1 : 0,
            secret ?? null,
            new Date().toISOString(),
            id,
        );
    }

    /** Takes the provider out of every site as well (ON DELETE CASCADE). */
    static delete(id: string): { changes: number } {
        return db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    }
}
