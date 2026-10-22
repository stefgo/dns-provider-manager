import { useState } from "react";
import { useParams } from "react-router-dom";
import { PlugZap, Server, X } from "lucide-react";
import {
    PROVIDER_TYPES,
    PROVIDER_TYPE_LABELS,
    WRITABLE_PROVIDER_TYPES,
    ProviderInputSchema,
    type Provider,
    type ProviderTestResult,
    type ProviderType,
} from "@dpm/shared";
import {
    ActionButton,
    Alert,
    Button,
    Card,
    Checkbox,
    FieldLabel,
    Input,
    LoadingIndicator,
    Select,
    Switch,
    Textarea,
} from "@stefgo/react-ui-components";
import { testProvider, useProviders, useSaveProvider } from "../../../queries/providers";
import { getErrorMessage, toggled } from "../../../utils";
import { useSites } from "../../../queries/sites";
import { QueryError } from "../../../components/QueryError";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { NotFoundError } from "../../../lib/notFound";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import {
    SECRET_LABEL,
    emptyProviderDraft,
    providerDraftFrom,
    providerFieldOf,
    providerInputFrom,
    providerRules,
    type ProviderDraft,
} from "../lib/providerForm";

/** `/providers/new` and `/providers/:providerId/edit`, read from the list like every editor. */
export const ProviderEditorRoute = () => {
    const { providerId } = useParams();
    const { providers, isPending, error } = useProviders();
    const provider = providers.find((p) => p.id === providerId);

    if (!providerId) return <ProviderEditor provider={null} />;
    if (!provider && error) return <QueryError title="Could not load the provider" error={error} />;
    if (!provider && isPending) return <LoadingIndicator label="Loading provider…" />;
    if (!provider) throw new NotFoundError("provider");
    return <ProviderEditor key={provider.id} provider={provider} />;
};

/**
 * The zones a provider sees, as its last reading found them. Under "All zones" -- the only
 * way a Samba AD domain is read -- they are listed with who uses each; under Cloudflare's
 * "Selected zones" each can be ticked: a zone another provider merely sees is taken over
 * that way, one another provider has ticked cannot be.
 */
const ZoneChoice = ({
    provider,
    draft,
    onChange,
}: {
    provider: Provider | null;
    draft: ProviderDraft;
    onChange: (zoneIds: string[]) => void;
}) => {
    const { providers } = useProviders();
    const zones = provider?.zones ?? [];
    if (!provider) {
        return <p className="text-sm text-text-muted">Save the provider, and the zones it sees are read.</p>;
    }
    if (zones.length === 0) {
        return (
            <p className="text-sm text-text-muted">
                {provider.lastError ? "The zones could not be read." : "No zone read yet."} They are listed once the provider
                answers.
            </p>
        );
    }
    const ownerOf = (owner: string | null) => providers.find((p) => p.id === owner);
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {zones.map((zone) => {
                const owner = zone.owner === provider.id ? null : ownerOf(zone.owner);
                const takenExplicitly =
                    owner?.type === "cloudflare" && owner.zoneMode === "selected" && owner.zoneIds.includes(zone.id);
                const note = owner ? `used by ${owner.name}` : zone.owner === provider.id ? "used here" : "not used";
                return draft.type === "cloudflare" && draft.zoneMode === "selected" ? (
                    <Checkbox
                        key={zone.id}
                        label={zone.name}
                        hint={takenExplicitly ? `chosen for ${owner.name}` : owner ? `${note}; ticking it takes it over` : undefined}
                        checked={draft.zoneIds.includes(zone.id)}
                        disabled={takenExplicitly}
                        onChange={(e) => onChange(toggled(draft.zoneIds, zone.id, e.target.checked))}
                    />
                ) : (
                    <div key={zone.id} className="text-sm">
                        <span className="text-text-primary">{zone.name}</span>{" "}
                        <span className={owner ? "text-warning" : "text-text-muted"}>· {note}</span>
                    </div>
                );
            })}
        </div>
    );
};

/** A switch with a label above it, laid out like the other fields of a row. */
const SwitchField = ({
    id,
    label,
    value,
    onChange,
    hint,
}: {
    id: string;
    label: string;
    value: boolean;
    onChange: (on: boolean) => void;
    hint: string;
}) => (
    <div>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="flex h-[42px] items-center">
            <Switch id={id} value={value} onChange={onChange} />
        </div>
        <p className="text-xs text-text-muted">{hint}</p>
    </div>
);

/**
 * Adds or edits one provider. The type is chosen once; a stored provider keeps it. The
 * secret is never shown -- the field is empty and saves nothing until something is typed
 * into it, and goes back to empty once it is stored.
 *
 * Which sites a provider belongs to is set in the site editor, where the question is asked
 * the right way round: which DNS servers give this site's answers.
 */
const ProviderEditor = ({ provider }: { provider: Provider | null }) => {
    const { mutateAsync: saveProvider } = useSaveProvider();
    const { sites } = useSites();
    const isNew = provider === null;

    const form = useEntityForm({
        schema: ProviderInputSchema,
        initial: () => (provider ? providerDraftFrom(provider) : emptyProviderDraft()),
        toInput: providerInputFrom,
        fieldOf: providerFieldOf,
        rules: providerRules(isNew),
    });
    const { draft, set, errors, isSaving } = form;
    const { close, leave } = useUnsavedChangesGuard(form.isDirty, isNew ? "newProvider" : "provider");

    const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
    const [testError, setTestError] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);

    // Asks the provider as it stands in the form; the stored secret stands in for an empty field.
    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        setTestError(null);
        try {
            setTestResult(await testProvider({ id: provider?.id, provider: providerInputFrom(draft) }));
        } catch (err) {
            setTestError(getErrorMessage(err));
        } finally {
            setIsTesting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // What is stored is not shown again: the secret field goes back to empty.
        const saved = await form.submit((input) => saveProvider({ id: provider?.id, input }), {
            rebase: (sent: ProviderDraft) => ({ ...sent, secret: "" }),
        });
        if (saved) leave();
    };

    const error = form.saveError ?? form.formError;
    const heading = provider ? `Edit ${provider.name}` : "Add Provider";
    const memberOf = sites.filter((s) => provider?.siteIds.includes(s.id)).map((s) => s.name);

    return (
        <Card
            title={
                <>
                    <Server size={18} className="text-text-muted" />
                    <HeaderBreadcrumb current={heading}>{heading}</HeaderBreadcrumb>
                </>
            }
            action={<ActionButton icon={X} tooltip="Close" onClick={close} />}
            padding="none"
        >
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
                {error && <Alert>{error}</Alert>}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                        label="Type"
                        value={draft.type}
                        onChange={(e) => set("type", e.target.value as ProviderType)}
                        options={PROVIDER_TYPES.map((type) => ({ value: type, label: PROVIDER_TYPE_LABELS[type] }))}
                        disabled={!isNew}
                        hint={isNew ? "Chosen once: a provider keeps its type." : "A provider keeps its type."}
                    />
                    <Input
                        label="Name"
                        value={draft.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder={draft.type === "cloudflare" ? "Cloudflare" : draft.type === "adguard" ? "AdGuard 1" : "Samba AD"}
                        error={errors.name}
                    />
                </div>

                {draft.type === "cloudflare" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input
                            label={SECRET_LABEL.cloudflare}
                            type="password"
                            autoComplete="off"
                            value={draft.secret}
                            onChange={(e) => set("secret", e.target.value)}
                            placeholder={isNew ? "" : "stored — leave empty to keep it"}
                            error={errors.secret}
                            hint="A token with Zone · Read and DNS · Edit, for all zones or the ones dpm may use."
                        />
                        <Select
                            label="Zones"
                            value={draft.zoneMode}
                            onChange={(e) => set("zoneMode", e.target.value as ProviderDraft["zoneMode"])}
                            options={[
                                { value: "all", label: "All zones the token sees" },
                                { value: "selected", label: "Selected zones" },
                            ]}
                            hint="A zone is used by one provider only. Ticking a zone here takes it over from one that merely sees it."
                        />
                    </div>
                )}

                {draft.type === "adguard" && (
                    <>
                        <Input
                            label="URL"
                            value={draft.url}
                            onChange={(e) => set("url", e.target.value)}
                            placeholder="http://192.168.1.2:3000"
                            error={errors.url}
                            hint="Where AdGuard Home's web interface answers."
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="User"
                                autoComplete="off"
                                value={draft.username}
                                onChange={(e) => set("username", e.target.value)}
                                error={errors.username}
                            />
                            <Input
                                label={SECRET_LABEL.adguard}
                                type="password"
                                autoComplete="off"
                                value={draft.secret}
                                onChange={(e) => set("secret", e.target.value)}
                                placeholder={isNew ? "" : "stored — leave empty to keep it"}
                                error={errors.secret}
                            />
                        </div>
                    </>
                )}

                {draft.type === "samba-ad" && (
                    <>
                        <Textarea
                            label="Domain Controllers"
                            rows={3}
                            value={draft.servers}
                            onChange={(e) => set("servers", e.target.value)}
                            placeholder={"dc1.ad.example.com\ndc2.ad.example.com"}
                            error={errors.servers}
                            hint="One per line, asked in this order over LDAPS; port 636 unless one is named."
                            classNames={{ textarea: "font-mono text-sm" }}
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="Service Account"
                                autoComplete="off"
                                value={draft.username}
                                onChange={(e) => set("username", e.target.value)}
                                placeholder="dpm@ad.example.com"
                                error={errors.username}
                            />
                            <Input
                                label={SECRET_LABEL["samba-ad"]}
                                type="password"
                                autoComplete="off"
                                value={draft.secret}
                                onChange={(e) => set("secret", e.target.value)}
                                placeholder={isNew ? "" : "stored — leave empty to keep it"}
                                error={errors.secret}
                            />
                        </div>
                    </>
                )}

                {draft.type !== "adguard" && (
                    <div>
                        <FieldLabel as="div">Zones</FieldLabel>
                        <ZoneChoice provider={provider} draft={draft} onChange={(zoneIds) => set("zoneIds", zoneIds)} />
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {draft.type !== "cloudflare" && (
                        <SwitchField
                            id="provider-self-signed"
                            label="Accept a Self-Signed Certificate"
                            value={draft.allowSelfSigned}
                            onChange={(on) => set("allowSelfSigned", on)}
                            hint="For a server whose certificate this host cannot verify. Off: such a connection fails."
                        />
                    )}
                    <SwitchField
                        id="provider-read-only"
                        label="Read Only"
                        value={draft.readOnly}
                        onChange={(on) => set("readOnly", on)}
                        hint={
                            WRITABLE_PROVIDER_TYPES.includes(draft.type)
                                ? "Read and compared, never written: nothing is created, changed or removed there. Records wait until it is switched off."
                                : `dpm does not write to ${PROVIDER_TYPE_LABELS[draft.type]} yet; it is read and compared either way.`
                        }
                    />
                    <SwitchField
                        id="provider-auto-correct"
                        label="Correct Drift by Itself"
                        value={draft.autoCorrect}
                        onChange={(on) => set("autoCorrect", on)}
                        hint="When a record was changed at the provider behind dpm's back, write dpm's value again without asking."
                    />
                </div>

                {provider && (
                    <p className="text-sm text-text-muted">
                        {memberOf.length > 0
                            ? `Belongs to the ${memberOf.length === 1 ? "site" : "sites"} ${memberOf.join(", ")}. Which sites a provider is in is set in each site.`
                            : "Belongs to no site yet. Add it to a site in the site's editor."}
                    </p>
                )}

                {testError && <Alert>{testError}</Alert>}
                {testResult && (
                    <Alert tone={testResult.ok ? "success" : "error"} title={testResult.message}>
                        {testResult.zones.length > 0 && (
                            <span className="text-xs">{testResult.zones.map((z) => z.name).join(", ")}</span>
                        )}
                    </Alert>
                )}

                <div className="flex justify-between gap-3 pt-4 border-t border-border">
                    <Button
                        type="button"
                        variant="secondary"
                        icon={PlugZap}
                        onClick={handleTest}
                        isLoading={isTesting}
                        disabled={isTesting || isSaving || (isNew && !form.isValid)}
                    >
                        Test Connection
                    </Button>
                    <div className="flex gap-3">
                        <Button type="button" variant="secondary" onClick={close}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" isLoading={isSaving} disabled={!form.canSave}>
                            Save
                        </Button>
                    </div>
                </div>
            </form>
        </Card>
    );
};
