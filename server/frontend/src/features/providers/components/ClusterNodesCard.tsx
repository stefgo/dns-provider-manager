import { useState } from "react";
import { Loader2, Network, RefreshCw, SearchCheck, X } from "lucide-react";
import { CONFIG_AREA_LABELS, type ClusterPreview, type ClusterProvider, type ClusterStatus } from "@dpm/shared";
import { ActionButton, Alert, Badge, Card, StatusDot, useToast } from "@stefgo/react-ui-components";
import { RelativeTime } from "../../../components/RelativeTime";
import { useCheckCluster, useRunCluster } from "../../../queries/clusters";
import { describeFailure } from "../../../utils";
import { LINK_STATUS, checkFindings, checkOutcome, nodeRows, syncOutcome } from "../lib/clusterForm";
import { readTone } from "../lib/providerDetails";

interface ClusterNodesCardProps {
    cluster: ClusterProvider;
    /** Undefined while the clusters' status has not arrived. */
    status: ClusterStatus | undefined;
}

/** What the last "Check" found, and when. */
interface CheckResult {
    at: string;
    result: ClusterPreview;
}

/**
 * The nodes of a cluster on its page: which one the others are copies of, what each answered,
 * and per node and area how the last run went. What is kept alike is chosen in the editor;
 * this only shows it, checks it and runs it.
 */
export const ClusterNodesCard = ({ cluster, status }: ClusterNodesCardProps) => {
    const { show } = useToast();
    const run = useRunCluster();
    const check = useCheckCluster();
    const [checked, setChecked] = useState<CheckResult | null>(null);
    const primary = cluster.nodes.find((n) => n.primary);
    const busy = run.isPending || check.isPending;

    const syncNow = () =>
        run
            .mutateAsync(cluster.id)
            .then((after) => {
                // What the check found is out of date once the run wrote.
                setChecked(null);
                show({ ...syncOutcome(cluster.name, after) });
            })
            .catch((err) => show({ variant: "error", ...describeFailure(`Could not keep ${cluster.name} alike`, err), duration: 0 }));

    const checkNow = () =>
        check
            .mutateAsync(cluster.id)
            .then((result) => {
                setChecked({ at: new Date().toISOString(), result });
                show({ ...checkOutcome(cluster.name, result) });
            })
            .catch((err) => show({ variant: "error", ...describeFailure(`Could not check ${cluster.name}`, err), duration: 0 }));

    return (
        <Card
            titleAs="h2"
            title={
                <>
                    <Network size={18} className="text-text-muted" />
                    Nodes
                </>
            }
            action={
                <div className="flex items-center gap-1">
                    <ActionButton
                        icon={check.isPending ? Loader2 : SearchCheck}
                        color="indigo"
                        tooltip="Check"
                        aria-label="Check"
                        disabled={busy}
                        classNames={{ icon: check.isPending ? "animate-spin" : undefined }}
                        onClick={checkNow}
                    />
                    <ActionButton
                        icon={RefreshCw}
                        color="green"
                        tooltip="Sync Now"
                        aria-label="Sync Now"
                        disabled={busy}
                        classNames={{ icon: run.isPending ? "animate-spin" : undefined }}
                        onClick={syncNow}
                    />
                </div>
            }
            padding="none"
        >
            <div className="space-y-4 p-6">
                <p className="text-sm text-text-muted">
                    Copied from <span className="font-medium text-text-primary">{primary?.name ?? "–"}</span>
                    {status?.lastRunAt && (
                        <>
                            {" "}
                            · last run <RelativeTime date={status.lastRunAt} />
                        </>
                    )}
                </p>
                {status?.pausedError && (
                    <Alert tone="warning" title={`Paused: ${primary?.name ?? "the primary"} cannot be read`}>
                        <span className="break-words">{status.pausedError}</span>
                    </Alert>
                )}
                <NodeList cluster={cluster} />
                {status && <NodeTable cluster={cluster} status={status} />}
                {checked && <CheckPanel checked={checked} primaryName={primary?.name ?? "the primary"} onClose={() => setChecked(null)} />}
            </div>
        </Card>
    );
};

/** What the last check found: per node and area what a run would write there. Nothing was written. */
const CheckPanel = ({ checked, primaryName, onClose }: { checked: CheckResult; primaryName: string; onClose: () => void }) => {
    const findings = checkFindings(checked.result);
    return (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text-primary">
                    Last check <RelativeTime date={checked.at} />
                </span>
                <ActionButton icon={X} tooltip="Close" onClick={onClose} />
            </div>
            {checked.result.error !== null ? (
                <p className="break-words text-error">{checked.result.error}</p>
            ) : findings.length === 0 ? (
                <p className="text-text-muted">Every node holds what {primaryName} holds.</p>
            ) : (
                <>
                    <p className="text-text-muted">What Sync Now would write, per node and area:</p>
                    <ul className="space-y-2">
                        {findings.map((f) => (
                            <li key={f.key}>
                                <span className="font-medium text-text-primary">
                                    {f.node} · {CONFIG_AREA_LABELS[f.area]}
                                </span>
                                {f.error !== null ? (
                                    <p className="break-words text-xs text-error">{f.error}</p>
                                ) : (
                                    <ul className="list-disc pl-5 text-xs text-text-muted">
                                        {f.lines.map((line, i) => (
                                            <li key={i} className="break-words">
                                                {line}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
};

/** Every node with what it answered on the last run. */
const NodeList = ({ cluster }: { cluster: ClusterProvider }) => (
    <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {cluster.nodes.map((node) => (
            <li key={node.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <StatusDot tone={readTone(node)} size="sm" pulse={false} />
                <span className="font-medium text-text-primary">{node.name}</span>
                <span className="text-text-muted">{node.url}</span>
                {node.primary && <Badge variant="info">Primary</Badge>}
                <span className="ml-auto text-xs text-text-muted">
                    {node.lastError !== null ? (
                        <span className="text-error">{node.lastError}</span>
                    ) : node.lastSeenAt ? (
                        <>
                            {node.version ?? "?"} · <RelativeTime date={node.lastSeenAt} />
                        </>
                    ) : (
                        "Not reached yet"
                    )}
                </span>
            </li>
        ))}
    </ul>
);

/** Where each area stands at each node besides the primary, and why where it failed. */
const NodeTable = ({ cluster, status }: { cluster: ClusterProvider; status: ClusterStatus }) => {
    const rows = nodeRows(status, cluster.nodes);
    if (rows.length === 0) return <p className="text-sm text-text-muted">The cluster has no other node to copy to yet.</p>;
    const problems = rows.flatMap((row) =>
        row.links
            .filter(({ link }) => link?.error)
            .map(({ area, link }) => ({ key: `${row.node.id}:${area}`, text: `${row.node.name} · ${CONFIG_AREA_LABELS[area]}: ${link!.error}` })),
    );
    return (
        <div className="space-y-3">
            <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-xs text-text-muted">
                            <th className="px-3 py-2 font-medium">Node</th>
                            {status.areas.map((area) => (
                                <th key={area} className="px-3 py-2 font-medium">
                                    {CONFIG_AREA_LABELS[area]}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.node.id} className="border-b border-border last:border-b-0">
                                <td className="px-3 py-2 font-medium text-text-primary">{row.node.name}</td>
                                {row.links.map(({ area, link }) => {
                                    const shown = link ? LINK_STATUS[link.status] : { tone: "unknown" as const, label: "Not run yet" };
                                    return (
                                        <td key={area} className="px-3 py-2" title={link?.error ?? undefined}>
                                            <span className="inline-flex items-center gap-2 whitespace-nowrap text-text-muted">
                                                <StatusDot tone={shown.tone} size="sm" pulse={false} />
                                                {shown.label}
                                            </span>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {problems.length > 0 && (
                <ul className="space-y-1 text-xs text-text-muted">
                    {problems.map((p) => (
                        <li key={p.key} className="break-words">
                            {p.text}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
