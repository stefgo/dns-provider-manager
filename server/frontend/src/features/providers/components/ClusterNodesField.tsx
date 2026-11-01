import { useState, type KeyboardEvent } from "react";
import { Crown, Pencil, Trash2 } from "lucide-react";
import type { ClusterProvider } from "@dpm/shared";
import { ActionButton, Badge, Button, Input, StatusDot, Switch, FieldLabel } from "@stefgo/react-ui-components";
import { ItemBox } from "../../../components/ItemBox";
import { InfoGrid, InfoRow } from "../../../components/MultiSelectField";
import { RelativeTime } from "../../../components/RelativeTime";
import { emptyNodeDraft, makePrimary, nodeErrors, putNode, removeNode, type NodeDraft, type NodeErrors } from "../lib/clusterForm";
import { readTone } from "../lib/providerDetails";

/** One node as the form edits it: a node of the list, or one to be added. */
const NodeForm = ({
    initial,
    others,
    onDone,
    onCancel,
}: {
    initial: NodeDraft;
    others: readonly NodeDraft[];
    onDone: (node: NodeDraft) => void;
    onCancel: () => void;
}) => {
    const [node, setNode] = useState(initial);
    // Shown once "Done" was tried: a field is not wrong while it is still being typed.
    const [errors, setErrors] = useState<NodeErrors>({});
    const isNew = !others.some((o) => o.key === initial.key);
    const set = <K extends keyof NodeDraft>(key: K, value: NodeDraft[K]) => setNode((n) => ({ ...n, [key]: value }));

    const done = () => {
        const found = nodeErrors(node, others);
        if (Object.keys(found).length > 0) {
            setErrors(found);
            return;
        }
        onDone({ ...node, name: node.name.trim(), url: node.url.trim(), username: node.username.trim() });
    };

    // Enter would save the whole provider: here it takes the node into the list.
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Enter" || (e.target as HTMLElement).tagName !== "INPUT") return;
        e.preventDefault();
        done();
    };

    return (
        <div className="space-y-1" onKeyDown={onKeyDown}>
            <FieldLabel as="div" className="mb-0">
                {isNew ? "Add Node" : `Edit ${initial.name}`}
            </FieldLabel>
            <div className="space-y-4 rounded-lg border border-border bg-app-bg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Name" value={node.name} onChange={(e) => set("name", e.target.value)} error={errors.name} placeholder="adguard-1" />
                    <Input
                        label="URL"
                        value={node.url}
                        onChange={(e) => set("url", e.target.value)}
                        error={errors.url}
                        placeholder="http://192.168.1.2:3000"
                        hint="Its own address, not a shared one: a change made through it is meant for this node."
                    />
                    <Input label="User" autoComplete="off" value={node.username} onChange={(e) => set("username", e.target.value)} error={errors.username} />
                    <Input
                        label="Password"
                        type="password"
                        autoComplete="off"
                        value={node.secret}
                        onChange={(e) => set("secret", e.target.value)}
                        placeholder={node.hasSecret ? "stored — leave empty to keep it" : ""}
                        error={errors.secret}
                    />
                </div>
                <div className="flex items-center gap-3">
                    <Switch id={`node-self-signed-${node.key}`} value={node.allowSelfSigned} onChange={(on) => set("allowSelfSigned", on)} />
                    <label htmlFor={`node-self-signed-${node.key}`} className="text-sm text-text-primary">
                        Accept a self-signed certificate
                    </label>
                </div>
                <div className="flex justify-end gap-3">
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="button" variant="primary" onClick={done}>
                        {isNew ? "Add" : "Done"}
                    </Button>
                </div>
            </div>
        </div>
    );
};

interface ClusterNodesFieldProps {
    /** The stored cluster, for what each node answered; null for a new one. */
    cluster: ClusterProvider | null;
    nodes: NodeDraft[];
    onChange: (nodes: NodeDraft[]) => void;
    /** The node the form edits: its key, a node to be added, or none. The editor holds it: Escape closes the form first. */
    editing: NodeDraft | null;
    onSetEditing: (node: NodeDraft | null) => void;
    error?: string;
}

/**
 * The nodes of a cluster, shown the way a site shows its providers: each row opens to where
 * the node is reached and what it answered, and ends in its buttons. Adding or editing a node
 * opens its form in the box's place.
 */
export const ClusterNodesField = ({ cluster, nodes, onChange, editing, onSetEditing, error }: ClusterNodesFieldProps) => {
    if (editing) {
        return (
            <NodeForm
                key={editing.key}
                initial={editing}
                others={nodes}
                onCancel={() => onSetEditing(null)}
                onDone={(node) => {
                    onChange(putNode(nodes, node));
                    onSetEditing(null);
                }}
            />
        );
    }

    const stored = (node: NodeDraft) => cluster?.nodes.find((n) => n.id === node.id) ?? null;

    return (
        <ItemBox
            label="Nodes"
            action={{ label: "Add Node", onClick: () => onSetEditing(emptyNodeDraft(nodes)) }}
            items={nodes.map((node) => ({ ...node, id: node.key }))}
            renderName={(node) => {
                const known = stored(node);
                return (
                    <div className="flex min-w-0 items-center gap-2">
                        {known && <StatusDot tone={readTone(known)} />}
                        <span className="truncate text-sm font-medium text-text-primary">{node.name}</span>
                        <span className="truncate text-xs text-text-muted">{node.url}</span>
                        {node.primary && <Badge variant="info">Primary</Badge>}
                    </div>
                );
            }}
            renderInfo={(node) => {
                const known = stored(node);
                return (
                    <InfoGrid>
                        <InfoRow label="URL">{node.url}</InfoRow>
                        <InfoRow label="User">{node.username}</InfoRow>
                        <InfoRow label="Password">{node.secret ? "New, saved with the cluster" : node.hasSecret ? "Stored" : "Not stored"}</InfoRow>
                        <InfoRow label="Self-Signed Certificate">{node.allowSelfSigned ? "Accepted" : "Refused"}</InfoRow>
                        {known && <InfoRow label="Version">{known.version ?? "Not known yet"}</InfoRow>}
                        {known && (
                            <InfoRow label="Last Reached">
                                {known.lastError !== null ? (
                                    <span className="text-error">{known.lastError}</span>
                                ) : known.lastSeenAt ? (
                                    <RelativeTime date={known.lastSeenAt} />
                                ) : (
                                    "Not yet"
                                )}
                            </InfoRow>
                        )}
                        {!known && <InfoRow label="State">New: the next run after saving makes it a copy of the primary</InfoRow>}
                    </InfoGrid>
                );
            }}
            renderActions={(node) => (
                <>
                    {!node.primary && (
                        <ActionButton icon={Crown} size="sm" tooltip="Make Primary" onClick={() => onChange(makePrimary(nodes, node.key))} />
                    )}
                    <ActionButton icon={Pencil} size="sm" tooltip="Edit Node" onClick={() => onSetEditing(nodes.find((n) => n.key === node.key) ?? null)} />
                    <ActionButton icon={Trash2} size="sm" color="orange" tooltip="Remove from Cluster" onClick={() => onChange(removeNode(nodes, node.key))} />
                </>
            )}
            empty="No node yet. The first node added is the primary."
            footer={
                <>
                    {error && <p className="text-xs text-error">{error}</p>}
                    <p className="ml-1 text-xs leading-relaxed text-text-muted">
                        dpm reads and writes the primary and makes every other node a copy of it. Change the configuration at the primary&apos;s
                        own address: what is changed at another node is written over.
                    </p>
                </>
            }
        />
    );
};
