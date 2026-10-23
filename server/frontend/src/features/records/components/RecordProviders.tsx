import { useMemo } from "react";
import type { DnsRecord, Provider, RecordInput, SkippedProvider } from "@dpm/shared";
import { Alert, Button, FieldLabel, LoadingIndicator, StatusDot } from "@stefgo/react-ui-components";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { useRecordPreview } from "../../../queries/records";
import { getErrorMessage } from "../../../utils";
import { useLinkActions } from "../hooks/useLinkActions";
import { ACTION_LABEL, ACTION_TONE, LINK_LABEL, LINK_TONE, linkDetail, linksInOrder, providerName } from "../lib/recordSync";

interface RecordProvidersProps {
    /** The stored record; null while it is being added. */
    record: DnsRecord | null;
    /** The draft as the request takes it, while it is valid. */
    input: RecordInput | null;
    isDirty: boolean;
    providers: Provider[];
}

/** One line of the section: a dot, the provider, what it says, and what can be done. */
const Line = ({ tone, name, text, detail, children }: { tone: Parameters<typeof StatusDot>[0]["tone"]; name: string; text: string; detail?: string | null; children?: React.ReactNode }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
        <StatusDot tone={tone} size="sm" pulse={false} />
        <span className="font-medium text-text-primary">{name}</span>
        <span className="text-sm text-text-secondary">{text}</span>
        {detail && <span className="text-sm text-text-muted">— {detail}</span>}
        {children && <span className="ml-auto flex gap-2">{children}</span>}
    </li>
);

const Skipped = ({ skipped, providers }: { skipped: SkippedProvider[]; providers: Provider[] }) =>
    skipped.map((s) => <Line key={s.providerId} tone="unknown" name={providerName(s.providerId, providers)} text="Does not get it" detail={s.reason} />);

/**
 * Where the record stands at each provider, with what can be done about drift -- and, while
 * the draft differs from what is stored, what saving would do at each one. The preview
 * follows the draft once typing pauses.
 */
export const RecordProviders = ({ record, input, isDirty, providers }: RecordProvidersProps) => {
    const actions = useLinkActions();
    // By its text, so a draft that renders again without a change asks nothing new.
    const asked = JSON.stringify(input && (isDirty || !record) ? { id: record?.id, record: input } : null);
    const settled = useDebouncedValue(asked, 400);
    const request = useMemo(() => JSON.parse(settled) as { id?: string; record: RecordInput } | null, [settled]);
    const preview = useRecordPreview(request);
    const writable = (id: string) => providers.find((p) => p.id === id)?.writable ?? false;

    return (
        <div>
            <FieldLabel as="div">{request === null ? "Providers" : "Changes to providers"}</FieldLabel>
            {record && !isDirty && (
                <ul className="divide-y divide-border">
                    {record.links.length === 0 && record.skipped.length === 0 && (
                        <li className="py-1.5 text-sm text-text-muted">Its sites write to no provider.</li>
                    )}
                    {linksInOrder(record.links, providers).map((link) => (
                        <Line
                            key={link.providerId}
                            tone={LINK_TONE[link.status]}
                            name={providerName(link.providerId, providers)}
                            text={LINK_LABEL[link.status]}
                            detail={linkDetail(link)}
                        >
                            {(link.status === "drift" || link.status === "missing") && (
                                <>
                                    {writable(link.providerId) && (
                                        <Button type="button" size="sm" variant="secondary" onClick={() => actions.rewrite(record, link)}>
                                            Write again
                                        </Button>
                                    )}
                                    <Button type="button" size="sm" variant="secondary" onClick={() => actions.accept(record, link)}>
                                        Take over
                                    </Button>
                                </>
                            )}
                        </Line>
                    ))}
                    <Skipped skipped={record.skipped} providers={providers} />
                </ul>
            )}
            {request === null && !record && <p className="py-1.5 text-sm text-text-muted">Fill in the record to see where it goes.</p>}
            {request !== null &&
                (preview.error ? (
                    <Alert title="Could not work out what saving does">{getErrorMessage(preview.error)}</Alert>
                ) : !preview.data ? (
                    <LoadingIndicator label="Working out what saving does…" />
                ) : (
                    <div className="space-y-2">
                        {preview.data.conflict && <Alert>{preview.data.conflict}</Alert>}
                        <ul className="divide-y divide-border">
                            {preview.data.steps.length === 0 && preview.data.skipped.length === 0 && (
                                <li className="py-1.5 text-sm text-text-muted">Nothing is written: its sites write to no provider.</li>
                            )}
                            {linksInOrder(preview.data.steps, providers).map((step) => (
                                <Line
                                    key={step.providerId}
                                    tone={ACTION_TONE[step.action]}
                                    name={providerName(step.providerId, providers)}
                                    text={ACTION_LABEL[step.action]}
                                    detail={step.reason}
                                />
                            ))}
                            <Skipped skipped={preview.data.skipped} providers={providers} />
                        </ul>
                    </div>
                ))}
        </div>
    );
};
