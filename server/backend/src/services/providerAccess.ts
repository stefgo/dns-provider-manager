import type { Provider, ProviderFields } from "@dpm/shared";
import { logger } from "@dpm/shared/node";
import type { DnsProviderClient } from "../providers/DnsProvider.js";
import type { ClusterNodeAccess } from "../providers/adguard/AdGuardClusterClient.js";
import { clientFor } from "../providers/clients.js";
import { ClusterRepository } from "../repositories/ClusterRepository.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { RequestError } from "./RequestError.js";
import { decryptSecret } from "./SecretCrypto.js";

type ClusterProvider = Extract<Provider, { type: "adguard-cluster" }>;

/**
 * The nodes of a stored cluster with their passwords in the clear, and whether each follows
 * the writes of records: those whose rewrites the last run left in step with the primary's.
 * Null while a node has no password.
 */
export function clusterNodeAccess(provider: ClusterProvider): ClusterNodeAccess[] | null {
    const secrets = ClusterRepository.storedSecrets(provider.id);
    const inStep = new Set(
        ClusterRepository.links(provider.id)
            .filter((l) => l.area === "rewrites" && l.status === "in_sync")
            .map((l) => l.nodeId),
    );
    const nodes: ClusterNodeAccess[] = [];
    for (const node of provider.nodes) {
        const stored = secrets.get(node.id);
        if (!stored) return null;
        nodes.push({
            id: node.id,
            name: node.name,
            url: node.url,
            username: node.username,
            password: decryptSecret(stored),
            allowSelfSigned: node.allowSelfSigned,
            primary: node.primary,
            followsWrites: inStep.has(node.id),
        });
    }
    return nodes.some((n) => n.primary) ? nodes : null;
}

/**
 * The client of a stored provider, its secrets decrypted; null while one is missing. A node
 * of a cluster that a write of a record does not reach is marked behind, for the next run.
 */
export function storedClient(provider: Provider): DnsProviderClient | null {
    if (provider.type === "adguard-cluster") {
        const nodes = clusterNodeAccess(provider);
        if (!nodes) return null;
        return clientFor(
            {
                type: "adguard-cluster",
                nodes,
                onNodeBehind: (nodeId, error) => {
                    const node = nodes.find((n) => n.id === nodeId);
                    logger.warn({ cluster: provider.name, node: node?.name, error }, "A record could not be written to a node of a cluster");
                    ClusterRepository.markBehind(nodeId, "rewrites", error);
                },
            },
            "",
        );
    }
    const stored = ProviderRepository.storedSecret(provider.id);
    if (!stored) return null;
    return clientFor(provider, decryptSecret(stored));
}

/**
 * The nodes of a cluster as the editor holds it, saved or not: the password typed, or the
 * stored one of the node `id` names. Throws a `RequestError` naming a node without either.
 */
export function editorNodeAccess(fields: Extract<ProviderFields, { type: "adguard-cluster" }>, id?: string): ClusterNodeAccess[] {
    const secrets = id ? ClusterRepository.storedSecrets(id) : new Map<string, string>();
    return fields.nodes.map((node) => {
        const stored = node.id ? secrets.get(node.id) : undefined;
        const password = node.secret ?? (stored ? decryptSecret(stored) : undefined);
        if (!password) throw new RequestError(400, `Enter the password of ${node.name}`);
        return {
            id: node.id ?? `new:${node.name}`,
            name: node.name,
            url: node.url,
            username: node.username,
            password,
            allowSelfSigned: node.allowSelfSigned,
            primary: node.primary,
            followsWrites: false,
        };
    });
}

/**
 * The client of a provider as the editor holds it, saved or not. `id` names the stored
 * provider whose secrets stand in where none was typed. Throws a `RequestError` for a secret
 * that is neither typed nor stored.
 */
export function editorClient(fields: ProviderFields, id?: string): DnsProviderClient {
    if (fields.type === "adguard-cluster") return clientFor({ type: "adguard-cluster", nodes: editorNodeAccess(fields, id) }, "");
    let secret = fields.secret;
    if (!secret && id) {
        const stored = ProviderRepository.storedSecret(id);
        if (stored === null) throw new RequestError(404, "Provider not found");
        secret = decryptSecret(stored);
    }
    if (!secret) throw new RequestError(400, fields.type === "cloudflare" ? "Enter the API token" : "Enter the password");
    return clientFor(fields, secret);
}
