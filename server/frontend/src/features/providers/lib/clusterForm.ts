import {
    CONFIG_AREA_LABELS,
    ClusterNodeInputSchema,
    adguardAddressKey,
    firstIssue,
    type ClusterNode,
    type ClusterNodeInput,
    type ClusterPreview,
    type ClusterStatus,
    type ConfigArea,
    type ConfigLinkStatus,
    type ClusterLinkView,
} from "@dpm/shared";
import type { StatusDotTone } from "@stefgo/react-ui-components";
import { plural } from "../../../utils";

/**
 * One node of a cluster as the editor holds it. `key` tells the rows apart -- a stored node's
 * id, or one made up for a node not saved yet. `secret` is only ever a new password: the
 * server never sends the stored one back, and an empty field keeps it.
 */
export interface NodeDraft {
    key: string;
    id: string | null;
    name: string;
    url: string;
    username: string;
    secret: string;
    allowSelfSigned: boolean;
    primary: boolean;
    /** Whether the server holds a password for it already. */
    hasSecret: boolean;
}

let lastKey = 0;
/** A key for a node not saved yet. Not `crypto.randomUUID`: that needs a secure context, and dpm is often reached over plain http. */
const newKey = () => `new-${++lastKey}`;

export const nodeDraftsFrom = (nodes: readonly ClusterNode[]): NodeDraft[] =>
    nodes.map((node) => ({
        key: node.id,
        id: node.id,
        name: node.name,
        url: node.url,
        username: node.username,
        secret: "",
        allowSelfSigned: node.allowSelfSigned,
        primary: node.primary,
        hasSecret: node.hasSecret,
    }));

/**
 * A node to be added: named after its place, signing in as the last one does -- the nodes of
 * a cluster are mostly set up alike. The first node of a cluster is its primary.
 */
export function emptyNodeDraft(nodes: readonly NodeDraft[]): NodeDraft {
    const taken = new Set(nodes.map((n) => n.name.toLowerCase()));
    let n = nodes.length + 1;
    while (taken.has(`adguard-${n}`)) n++;
    const last = nodes[nodes.length - 1];
    return {
        key: newKey(),
        id: null,
        name: `adguard-${n}`,
        url: "",
        username: last?.username ?? "",
        secret: "",
        allowSelfSigned: last?.allowSelfSigned ?? false,
        primary: nodes.length === 0,
        hasSecret: false,
    };
}

export const nodeInputFrom = (node: NodeDraft): ClusterNodeInput => ({
    id: node.id ?? undefined,
    name: node.name,
    url: node.url,
    username: node.username,
    secret: node.secret === "" ? undefined : node.secret,
    allowSelfSigned: node.allowSelfSigned,
    primary: node.primary,
});

export type NodeErrors = Partial<Record<"name" | "url" | "username" | "secret", string>>;

/** What is wrong with a node before it may join the list: its fields, a name or an address another node has, a password missing. */
export function nodeErrors(node: NodeDraft, others: readonly NodeDraft[]): NodeErrors {
    const errors: NodeErrors = {};
    const parsed = ClusterNodeInputSchema.safeParse(nodeInputFrom(node));
    if (!parsed.success) {
        for (const issue of parsed.error.issues) {
            const field = issue.path[0];
            if ((field === "name" || field === "url" || field === "username" || field === "secret") && !errors[field]) errors[field] = issue.message;
        }
        if (Object.keys(errors).length === 0) errors.name = firstIssue(parsed.error);
    }
    const rest = others.filter((o) => o.key !== node.key);
    if (!errors.name && rest.some((o) => o.name.trim().toLowerCase() === node.name.trim().toLowerCase())) {
        errors.name = `Another node is called "${node.name.trim()}" already`;
    }
    if (!errors.url && rest.some((o) => adguardAddressKey(o.url) === adguardAddressKey(node.url))) {
        errors.url = "Another node has this address already";
    }
    if (!node.hasSecret && node.secret === "") errors.secret = "Enter the password";
    return errors;
}

/** The nodes with `node` in its place -- or added at the end. A node made primary takes it from the one before. */
export function putNode(nodes: readonly NodeDraft[], node: NodeDraft): NodeDraft[] {
    const put = nodes.some((n) => n.key === node.key) ? nodes.map((n) => (n.key === node.key ? node : n)) : [...nodes, node];
    return node.primary ? put.map((n) => (n.key === node.key ? n : { ...n, primary: false })) : put;
}

/** The nodes without one. When the primary goes, the first of the rest takes its place, for the editor to change before saving. */
export function removeNode(nodes: readonly NodeDraft[], key: string): NodeDraft[] {
    const removed = nodes.find((n) => n.key === key);
    const rest = nodes.filter((n) => n.key !== key);
    if (removed?.primary && rest.length > 0 && !rest.some((n) => n.primary)) return rest.map((n, i) => ({ ...n, primary: i === 0 }));
    return rest;
}

export const makePrimary = (nodes: readonly NodeDraft[], key: string): NodeDraft[] => nodes.map((n) => ({ ...n, primary: n.key === key }));

/**
 * The question before a cluster is saved, from what its preview read at the nodes: what the
 * next run writes to each node that starts over. Null where nothing is written.
 */
export function describeClusterSave(
    clusterName: string,
    preview: ClusterPreview | { error: string },
    primaryChanged: { from: string; to: string } | null,
): { title: string; lines: string[]; danger: boolean } | null {
    const lines: string[] = [];
    if (primaryChanged) {
        lines.push(`${primaryChanged.to} becomes the primary: its records and its configuration count from now on, those of ${primaryChanged.from} are written over.`);
    }
    if ("nodes" in preview && preview.error === null) {
        for (const node of preview.nodes) {
            const failed = node.areas.filter((a) => a.error !== null);
            const changed = node.areas.filter((a) => a.error === null && a.steps.length > 0);
            if (changed.length > 0) {
                const steps = changed.flatMap((a) => a.steps);
                const shown = steps.slice(0, 3).join("; ");
                const more = steps.length > 3 ? ` and ${steps.length - 3} more` : "";
                lines.push(`${node.name}: ${plural(steps.length, "change")} in ${changed.map((a) => CONFIG_AREA_LABELS[a.area]).join(", ")} (${shown}${more}).`);
            }
            for (const area of failed) lines.push(`${node.name}: ${CONFIG_AREA_LABELS[area.area]} cannot be read (${area.error}).`);
        }
    } else {
        lines.push(`What the nodes hold could not be read: ${preview.error}. Saving anyway writes the primary's state to them with the next run.`);
    }
    if (lines.length === 0) return null;
    return { title: `Save ${clusterName}?`, lines, danger: true };
}

/** How a link's status is shown: its dot and its word. */
export const LINK_STATUS: Record<ConfigLinkStatus, { tone: StatusDotTone; label: string }> = {
    in_sync: { tone: "success", label: "In step" },
    pending: { tone: "warning", label: "Waiting" },
    error: { tone: "error", label: "Failed" },
    paused: { tone: "neutral", label: "Paused" },
};

/** One node besides the primary with its link per area -- none yet for an area not run since it was chosen. */
export interface NodeRow {
    node: Pick<ClusterNode, "id" | "name">;
    links: { area: ConfigArea; link: ClusterLinkView | null }[];
}

/** The rows of the status table: every node besides the primary, in the cluster's order, each with every area it keeps. */
export function nodeRows(status: ClusterStatus, nodes: readonly Pick<ClusterNode, "id" | "name">[]): NodeRow[] {
    return nodes
        .filter((n) => n.id !== status.primaryNodeId)
        .map((node) => ({
            node,
            links: status.areas.map((area) => ({ area, link: status.links.find((l) => l.nodeId === node.id && l.area === area) ?? null })),
        }));
}

/** What the provider list says about a cluster, or null while it has not run with a node to copy to. */
export function clusterBadge(status: ClusterStatus | undefined): { label: string; variant: "success" | "warning" | "error" } | null {
    if (!status) return null;
    if (status.pausedError !== null) return { label: "Paused", variant: "warning" };
    if (status.links.some((l) => l.status === "error")) return { label: "Nodes failed", variant: "error" };
    if (status.links.some((l) => l.status === "pending" || l.status === "paused")) return { label: "Nodes waiting", variant: "warning" };
    if (status.links.length === 0) return null;
    return { label: "Nodes in step", variant: "success" };
}

/** What a toast says after "Sync now": how the cluster stands once the run is done. */
export function syncOutcome(clusterName: string, status: ClusterStatus): { variant: "success" | "warning" | "error"; title: string; description?: string } {
    if (status.pausedError !== null) return { variant: "warning", title: `${clusterName}: paused`, description: status.pausedError };
    const failed = status.links.filter((l) => l.status === "error").length;
    if (failed > 0) return { variant: "error", title: `${clusterName} not alike everywhere`, description: `${plural(failed, "area")} failed` };
    const waiting = status.links.filter((l) => l.status === "pending").length;
    if (waiting > 0) return { variant: "warning", title: `${clusterName} partly alike`, description: `${plural(waiting, "area")} waiting` };
    return { variant: "success", title: `${clusterName}: every node in step` };
}

/** At most this many changes are listed per node and area after a check; the rest are counted. */
export const MAX_CHECK_LINES = 20;

/** One node and area a check found different from the primary, or could not compare. */
export interface CheckFinding {
    key: string;
    node: string;
    area: ConfigArea;
    /** The changes a run would write there, a sentence each, the rest counted. Empty where `error` is set. */
    lines: string[];
    error: string | null;
}

/** What a check found: only the nodes and areas that differ or could not be read, in the cluster's order. */
export function checkFindings(result: ClusterPreview): CheckFinding[] {
    return result.nodes.flatMap((node) =>
        node.areas
            .filter((a) => a.error !== null || a.steps.length > 0)
            .map((a) => ({
                key: `${node.name}:${a.area}`,
                node: node.name,
                area: a.area,
                lines:
                    a.steps.length <= MAX_CHECK_LINES
                        ? [...a.steps]
                        : [...a.steps.slice(0, MAX_CHECK_LINES), `and ${a.steps.length - MAX_CHECK_LINES} more`],
                error: a.error,
            })),
    );
}

/** What a toast says after "Check": whether the nodes hold what the primary holds. Nothing was written. */
export function checkOutcome(clusterName: string, result: ClusterPreview): { variant: "success" | "warning" | "error"; title: string; description?: string } {
    if (result.error !== null) return { variant: "error", title: `${clusterName} could not be checked`, description: result.error };
    const areas = result.nodes.flatMap((n) => n.areas);
    const failed = areas.filter((a) => a.error !== null).length;
    const differ = areas.filter((a) => a.error === null && a.steps.length > 0).length;
    const parts = [differ > 0 ? `${plural(differ, "area")} ${differ === 1 ? "differs" : "differ"}` : null, failed > 0 ? `${plural(failed, "area")} cannot be read` : null].filter((p) => p !== null);
    if (failed > 0) return { variant: "error", title: `${clusterName}: check incomplete`, description: parts.join(", ") };
    if (differ > 0) return { variant: "warning", title: `${clusterName}: nodes differ`, description: `${parts.join(", ")} -- Sync Now writes them` };
    return { variant: "success", title: `${clusterName}: every node in step` };
}
