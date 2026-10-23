import { useMemo, useState } from "react";
import { PROVIDER_CAPABILITIES, type DnsRecord, type Provider, type RecordInput, type SkippedProvider } from "@dpm/shared";
import { Alert, Button, FieldLabel, Input, LoadingIndicator, StatusDot, Switch } from "@stefgo/react-ui-components";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { useRecordPreview } from "../../../queries/records";
import { getErrorMessage } from "../../../utils";
import { useLinkActions } from "../hooks/useLinkActions";
import { DEFAULT_SETTING, type SettingDraft } from "../lib/recordForm";
import { ACTION_LABEL, ACTION_TONE, LINK_LABEL, LINK_TONE, linkDetail, linksInOrder, providerName } from "../lib/recordSync";

interface RecordProvidersProps {
    /** The stored record; null while it is being added. */
    record: DnsRecord | null;
    /** The draft as the request takes it, while it is valid. */
    input: RecordInput | null;
    isDirty: boolean;
    providers: Provider[];
    /** TTL and proxy per provider, as typed, and what is wrong with each TTL. */
    settings: Record<string, SettingDraft>;
    settingErrors: Record<string, string>;
    onSetting: (providerId: string, change: Partial<SettingDraft>) => void;
}

interface LineProps {
    tone: Parameters<typeof StatusDot>[0]["tone"];
    name: string;
    text: string;
    detail?: string | null;
    /** What can be done there. */
    actions?: React.ReactNode;
    /** What can be set there. A slot of its own, so its fields stay put while `actions` come and go. */
    settings?: React.ReactNode;
}

/** One line of the section: a dot, the provider, what it says, and what can be set or done there. */
const Line = ({ tone, name, text, detail, actions, settings }: LineProps) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
        <StatusDot tone={tone} size="sm" pulse={false} />
        <span className="font-medium text-text-primary">{name}</span>
        <span className="text-sm text-text-secondary">{text}</span>
        {detail && <span className="text-sm text-text-muted">— {detail}</span>}
        {(actions || settings) && (
            <span className="ml-auto flex flex-wrap items-start gap-3">
                {actions}
                {settings}
            </span>
        )}
    </li>
);

const Skipped = ({ skipped, providers }: { skipped: SkippedProvider[]; providers: Provider[] }) =>
    skipped.map((s) => <Line key={s.providerId} tone="unknown" name={providerName(s.providerId, providers)} text="Does not get it" detail={s.reason} />);

/**
 * TTL and proxy at one provider, as far as it knows them. While Cloudflare proxies, it sets
 * the TTL to "Auto" itself; the field is kept, but cannot be changed.
 */
const SettingFields = ({
    provider,
    setting,
    error,
    onChange,
}: {
    provider: Provider;
    setting: SettingDraft;
    error: string | undefined;
    onChange: (change: Partial<SettingDraft>) => void;
}) => {
    const caps = PROVIDER_CAPABILITIES[provider.type];
    return (
        <>
            {caps.ttl && (
                <Input
                    aria-label={`TTL at ${provider.name}`}
                    title={setting.proxied ? "Cloudflare sets the TTL to Auto while it proxies" : "TTL in seconds; empty is the provider's default"}
                    inputMode="numeric"
                    className="w-32"
                    value={setting.ttl}
                    onChange={(e) => onChange({ ttl: e.target.value })}
                    placeholder="TTL: default"
                    disabled={caps.proxied && setting.proxied}
                    error={error}
                />
            )}
            {caps.proxied && (
                <div className="flex h-[42px] items-center">
                    <Switch label="Proxied" value={setting.proxied} onChange={(on) => onChange({ proxied: on })} />
                </div>
            )}
        </>
    );
};

/**
 * Where the record stands at each provider, with what can be done about drift -- and, while
 * the draft differs from what is stored, what saving would do at each one. The preview
 * follows the draft once typing pauses. Every provider the record goes to has its TTL and
 * proxy here, as far as it knows them.
 *
 * The lines stay one list whichever of the two they show, so a field being typed into is not
 * replaced while the preview catches up -- and a draft that is not valid for a moment keeps
 * the last preview rather than losing its lines.
 */
export const RecordProviders = ({ record, input, isDirty, providers, settings, settingErrors, onSetting }: RecordProvidersProps) => {
    const actions = useLinkActions();
    const wanted = isDirty || !record;
    // By its text, so a draft that renders again without a change asks nothing new.
    const fresh = wanted && input ? JSON.stringify({ id: record?.id, record: input }) : null;
    const [kept, setKept] = useState<string | null>(null);
    if (fresh !== null && fresh !== kept) setKept(fresh);
    const settled = useDebouncedValue(wanted ? (fresh ?? kept ?? "null") : "null", 400);
    const request = useMemo(() => JSON.parse(settled) as { id?: string; record: RecordInput } | null, [settled]);
    const preview = useRecordPreview(request);
    const providerOf = (id: string) => providers.find((p) => p.id === id);
    const writable = (id: string) => providerOf(id)?.writable ?? false;
    const showsPreview = request !== null && preview.data !== undefined;

    const fields = (providerId: string) => {
        const provider = providerOf(providerId);
        const caps = provider && PROVIDER_CAPABILITIES[provider.type];
        if (!provider || !caps || (!caps.ttl && !caps.proxied)) return null;
        return (
            <SettingFields
                provider={provider}
                setting={settings[providerId] ?? DEFAULT_SETTING}
                error={settingErrors[providerId]}
                onChange={(change) => onSetting(providerId, change)}
            />
        );
    };

    return (
        <div>
            <FieldLabel as="div">{request === null ? "Providers" : "Changes to providers"}</FieldLabel>
            {request !== null && preview.error && <Alert title="Could not work out what saving does">{getErrorMessage(preview.error)}</Alert>}
            {request !== null && !preview.data && !preview.error && <LoadingIndicator label="Working out what saving does…" />}
            {showsPreview && preview.data!.conflict && <Alert>{preview.data!.conflict}</Alert>}
            {request === null && !record && <p className="py-1.5 text-sm text-text-muted">Fill in the record to see where it goes.</p>}
            <ul className="divide-y divide-border">
                {showsPreview ? (
                    <>
                        {preview.data!.steps.length === 0 && preview.data!.skipped.length === 0 && (
                            <li className="py-1.5 text-sm text-text-muted">Nothing is written: its sites write to no provider.</li>
                        )}
                        {linksInOrder(preview.data!.steps, providers).map((step) => (
                            <Line
                                key={step.providerId}
                                tone={ACTION_TONE[step.action]}
                                name={providerName(step.providerId, providers)}
                                text={ACTION_LABEL[step.action]}
                                detail={step.reason}
                                settings={step.action !== "delete" && fields(step.providerId)}
                            />
                        ))}
                        <Skipped skipped={preview.data!.skipped} providers={providers} />
                    </>
                ) : (
                    record && (
                        <>
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
                                    actions={
                                        (link.status === "drift" || link.status === "missing") && (
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
                                        )
                                    }
                                    settings={link.status !== "removing" && fields(link.providerId)}
                                />
                            ))}
                            <Skipped skipped={record.skipped} providers={providers} />
                        </>
                    )
                )}
            </ul>
        </div>
    );
};
