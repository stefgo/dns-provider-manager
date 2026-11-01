import db from "../core/Database.js";
import {
    CONFIG_AREAS,
    CONFIG_LINK_STATUSES,
    type ClusterLinkView,
    type ClusterNode,
    type ConfigArea,
    type ConfigLinkStatus,
} from "@dpm/shared";

/** What a cluster keeps alike and how its last run went. */
export interface ClusterSettings {
    providerId: string;
    areas: ConfigArea[];
    pausedError: string | null;
    lastRunAt: string | null;
}

export interface ConfigBaseline {
    /** The primary's state as the last run found it, in comparable form but with every field. */
    state: unknown;
    hash: string;
}

/** Where one area stands at one node besides the primary. */
export interface ClusterLink extends ClusterLinkView {
    writtenHash: string | null;
}

/** A node as it is stored: `secret` is what `SecretCrypto` made of the password, undefined keeps the stored one. */
export interface StoredNode {
    id: string;
    name: string;
    url: string;
    username: string;
    allowSelfSigned: boolean;
    primary: boolean;
    secret: string | undefined;
}

interface NodeRow {
    id: string;
    provider_id: string;
    name: string;
    url: string;
    username: string;
    allow_self_signed: number;
    secret: string | null;
    is_primary: number;
    position: number;
    version: string | null;
    last_seen_at: string | null;
    last_error: string | null;
}

interface SettingsRow {
    provider_id: string;
    areas: string;
    paused_error: string | null;
    last_run_at: string | null;
}

interface LinkRow {
    node_id: string;
    area: string;
    written_hash: string | null;
    status: string;
    error: string | null;
    attempts: number;
    last_attempt_at: string | null;
    synced_at: string | null;
}

const isArea = (value: unknown): value is ConfigArea => (CONFIG_AREAS as readonly unknown[]).includes(value);

/** The areas of a row in the order of `CONFIG_AREAS`; what does not read is left out. */
function areasOf(text: string): ConfigArea[] {
    try {
        const value: unknown = JSON.parse(text);
        return Array.isArray(value) ? CONFIG_AREAS.filter((area) => value.includes(area)) : [];
    } catch {
        return [];
    }
}

const rowToNode = (row: NodeRow): ClusterNode & { providerId: string } => ({
    providerId: row.provider_id,
    id: row.id,
    name: row.name,
    url: row.url,
    username: row.username,
    allowSelfSigned: row.allow_self_signed === 1,
    primary: row.is_primary === 1,
    hasSecret: row.secret !== null && row.secret !== "",
    version: row.version,
    lastSeenAt: row.last_seen_at,
    lastError: row.last_error,
});

const rowToSettings = (row: SettingsRow): ClusterSettings => ({
    providerId: row.provider_id,
    areas: areasOf(row.areas),
    pausedError: row.paused_error,
    lastRunAt: row.last_run_at,
});

function rowToLink(row: LinkRow): ClusterLink | null {
    if (!isArea(row.area)) return null;
    return {
        nodeId: row.node_id,
        area: row.area,
        writtenHash: row.written_hash,
        status: (CONFIG_LINK_STATUSES as readonly string[]).includes(row.status) ? (row.status as ConfigLinkStatus) : "pending",
        error: row.error,
        attempts: row.attempts,
        lastAttemptAt: row.last_attempt_at,
        syncedAt: row.synced_at,
    };
}

/**
 * The nodes of the AdGuard Home clusters and what keeping them alike remembers. A cluster is a
 * provider (`ProviderRepository`); this is what it has besides.
 */
export class ClusterRepository {
    // ── Nodes ────────────────────────────────────────────────────────────────

    /** Every node of every cluster, in each cluster's order, without the passwords. */
    static allNodes(): (ClusterNode & { providerId: string })[] {
        return (db.prepare("SELECT * FROM cluster_nodes ORDER BY provider_id, position").all() as NodeRow[]).map(rowToNode);
    }

    static nodes(providerId: string): ClusterNode[] {
        return (db.prepare("SELECT * FROM cluster_nodes WHERE provider_id = ? ORDER BY position").all(providerId) as NodeRow[]).map(rowToNode);
    }

    /** The stored passwords of a cluster's nodes, as `SecretCrypto` made them, by node id. */
    static storedSecrets(providerId: string): Map<string, string> {
        const rows = db.prepare("SELECT id, secret FROM cluster_nodes WHERE provider_id = ?").all(providerId) as { id: string; secret: string | null }[];
        return new Map(rows.filter((r) => r.secret).map((r) => [r.id, r.secret!]));
    }

    /**
     * Saves what a cluster keeps alike and its nodes, as given and in their order: a node not
     * among them goes (and its links with it), a node with a new id is added. In one
     * transaction, so that the cluster never has two primaries or none.
     */
    static save(providerId: string, areas: readonly ConfigArea[], nodes: readonly StoredNode[]): void {
        const now = new Date().toISOString();
        const upsertSettings = db.prepare(
            `INSERT INTO provider_clusters (provider_id, areas) VALUES (?, ?)
             ON CONFLICT (provider_id) DO UPDATE SET areas = excluded.areas`,
        );
        const existing = db.prepare("SELECT id FROM cluster_nodes WHERE provider_id = ?");
        const remove = db.prepare("DELETE FROM cluster_nodes WHERE id = ?");
        const clearPrimary = db.prepare("UPDATE cluster_nodes SET is_primary = 0 WHERE provider_id = ?");
        const insert = db.prepare(
            `INSERT INTO cluster_nodes (id, provider_id, name, url, username, allow_self_signed, secret, is_primary, position, created_at)
             VALUES (@id, @providerId, @name, @url, @username, @allowSelfSigned, @secret, @primary, @position, @now)`,
        );
        const update = db.prepare(
            `UPDATE cluster_nodes
             SET name = @name, url = @url, username = @username, allow_self_signed = @allowSelfSigned,
                 secret = COALESCE(@secret, secret), is_primary = @primary, position = @position, updated_at = @now
             WHERE id = @id AND provider_id = @providerId`,
        );
        db.transaction(() => {
            upsertSettings.run(providerId, JSON.stringify(areas));
            const kept = new Set(nodes.map((n) => n.id));
            const stored = new Set((existing.all(providerId) as { id: string }[]).map((r) => r.id));
            for (const id of stored) if (!kept.has(id)) remove.run(id);
            clearPrimary.run(providerId);
            nodes.forEach((node, position) => {
                const row = {
                    id: node.id,
                    providerId,
                    name: node.name,
                    url: node.url,
                    username: node.username,
                    allowSelfSigned: node.allowSelfSigned ? 1 : 0,
                    secret: node.secret ?? null,
                    primary: node.primary ? 1 : 0,
                    position,
                    now,
                };
                if (stored.has(node.id)) update.run(row);
                else insert.run(row);
            });
        })();
    }

    /** What a run found at a node: its version and when it answered, or why it did not (the time then stays). */
    static markNode(nodeId: string, at: string, result: { version: string | null } | { error: string }): void {
        if ("error" in result) {
            db.prepare("UPDATE cluster_nodes SET last_error = ? WHERE id = ?").run(result.error, nodeId);
        } else {
            db.prepare("UPDATE cluster_nodes SET version = ?, last_seen_at = ?, last_error = NULL WHERE id = ?").run(result.version, at, nodeId);
        }
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    static settings(providerId: string): ClusterSettings | null {
        const row = db.prepare("SELECT * FROM provider_clusters WHERE provider_id = ?").get(providerId) as SettingsRow | undefined;
        return row ? rowToSettings(row) : null;
    }

    static allSettings(): ClusterSettings[] {
        return (db.prepare("SELECT * FROM provider_clusters").all() as SettingsRow[]).map(rowToSettings);
    }

    static setPausedError(providerId: string, error: string | null): void {
        db.prepare("UPDATE provider_clusters SET paused_error = ? WHERE provider_id = ?").run(error, providerId);
    }

    static setLastRun(providerId: string, at: string): void {
        db.prepare("UPDATE provider_clusters SET last_run_at = ? WHERE provider_id = ?").run(at, providerId);
    }

    // ── Baselines ────────────────────────────────────────────────────────────

    static baseline(providerId: string, area: ConfigArea): ConfigBaseline | null {
        const row = db.prepare("SELECT state, hash FROM cluster_baselines WHERE provider_id = ? AND area = ?").get(providerId, area) as
            | { state: string; hash: string }
            | undefined;
        if (!row) return null;
        try {
            return { state: JSON.parse(row.state), hash: row.hash };
        } catch {
            return null;
        }
    }

    static saveBaseline(providerId: string, area: ConfigArea, baseline: ConfigBaseline): void {
        db.prepare(
            `INSERT INTO cluster_baselines (provider_id, area, state, hash, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (provider_id, area) DO UPDATE SET state = excluded.state, hash = excluded.hash, updated_at = excluded.updated_at`,
        ).run(providerId, area, JSON.stringify(baseline.state), baseline.hash, new Date().toISOString());
    }

    // ── Links ────────────────────────────────────────────────────────────────

    /** The links of a cluster's nodes. */
    static links(providerId: string): ClusterLink[] {
        const rows = db
            .prepare(
                `SELECT l.* FROM cluster_links l JOIN cluster_nodes n ON n.id = l.node_id
                 WHERE n.provider_id = ? ORDER BY n.position, l.area`,
            )
            .all(providerId) as LinkRow[];
        return rows.map(rowToLink).filter((link): link is ClusterLink => link !== null);
    }

    static saveLink(link: ClusterLink): void {
        db.prepare(
            `INSERT INTO cluster_links (node_id, area, written_hash, status, error, attempts, last_attempt_at, synced_at)
             VALUES (@nodeId, @area, @writtenHash, @status, @error, @attempts, @lastAttemptAt, @syncedAt)
             ON CONFLICT (node_id, area) DO UPDATE SET
               written_hash = excluded.written_hash, status = excluded.status, error = excluded.error,
               attempts = excluded.attempts, last_attempt_at = excluded.last_attempt_at, synced_at = excluded.synced_at`,
        ).run(link);
    }

    /**
     * Marks one area at one node as behind, keeping what was written: a write of the records
     * that did not reach it. The next run brings it up to date. A node without a link yet has
     * nothing to keep.
     */
    static markBehind(nodeId: string, area: ConfigArea, error: string): void {
        db.prepare("UPDATE cluster_links SET status = 'pending', error = ? WHERE node_id = ? AND area = ?").run(error, nodeId, area);
    }

    /** Sets every link of the cluster to `status` with `error`, keeping what was written. */
    static markAll(providerId: string, status: ConfigLinkStatus, error: string | null): void {
        db.prepare(
            "UPDATE cluster_links SET status = ?, error = ? WHERE node_id IN (SELECT id FROM cluster_nodes WHERE provider_id = ?)",
        ).run(status, error, providerId);
    }

    /**
     * Drops what the cluster no longer keeps: the links of the primary (it is copied, never
     * written to) and of areas switched off, and the baselines of those areas.
     */
    static keepOnly(providerId: string, primaryNodeId: string | null, areas: readonly ConfigArea[]): void {
        const links = ClusterRepository.links(providerId);
        const dropLink = db.prepare("DELETE FROM cluster_links WHERE node_id = ? AND area = ?");
        const baselines = db.prepare("SELECT area FROM cluster_baselines WHERE provider_id = ?").all(providerId) as { area: string }[];
        const dropBaseline = db.prepare("DELETE FROM cluster_baselines WHERE provider_id = ? AND area = ?");
        db.transaction(() => {
            for (const link of links) {
                if (link.nodeId === primaryNodeId || !areas.includes(link.area)) dropLink.run(link.nodeId, link.area);
            }
            for (const { area } of baselines) if (!isArea(area) || !areas.includes(area)) dropBaseline.run(providerId, area);
        })();
    }

    /**
     * Starts the cluster over: no baselines, and every node as one dpm has written nothing to.
     * What follows a confirmed preview of another primary: the next run writes its state to
     * every node without reporting what it replaces.
     */
    static startOver(providerId: string): void {
        db.transaction(() => {
            db.prepare("DELETE FROM cluster_baselines WHERE provider_id = ?").run(providerId);
            db.prepare(
                `UPDATE cluster_links SET written_hash = NULL, status = 'pending', error = NULL, attempts = 0
                 WHERE node_id IN (SELECT id FROM cluster_nodes WHERE provider_id = ?)`,
            ).run(providerId);
        })();
    }
}
