import { Link, useParams } from "react-router-dom";
import { Globe, X } from "lucide-react";
import { RECORD_TYPES, RecordInputSchema, type DnsRecord, type RecordType } from "@dpm/shared";
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
import { useRecords, useSaveRecord } from "../../../queries/records";
import { useSites } from "../../../queries/sites";
import { useProviders } from "../../../queries/providers";
import { QueryError } from "../../../components/QueryError";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { NotFoundError } from "../../../lib/notFound";
import { ROUTES } from "../../../lib/paths";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { getErrorMessage, toggled } from "../../../utils";
import {
    EMPTY_RECORD_DRAFT,
    VALUE_PLACEHOLDER,
    reachesCloudflare,
    recordDraftFrom,
    recordInputFrom,
    recordRules,
} from "../lib/recordForm";

/**
 * `/records/new` and `/records/:recordId`. The record is read from the list -- there is no
 * single-item endpoint. A link to an id that is gone gets the not-found card.
 */
export const RecordEditorRoute = () => {
    const { recordId } = useParams();
    const { records, isPending, error } = useRecords();
    const record = records.find((r) => r.id === recordId);

    if (!recordId) return <RecordEditor record={null} />;
    // Not "not found": without the list nothing says whether the record exists.
    if (!record && error) return <QueryError title="Could not load the record" error={error} />;
    if (!record && isPending) return <LoadingIndicator label="Loading record…" />;
    if (!record) throw new NotFoundError("record");
    // Keyed, so pointing the route at another record starts the form over.
    return <RecordEditor key={record.id} record={record} />;
};

/**
 * Adds or edits one record. The draft is checked against `RecordInputSchema`, the schema
 * the request is parsed with; what clashes with another record -- the same record twice, a
 * CNAME beside another record of its name -- the server says on save.
 */
const RecordEditor = ({ record }: { record: DnsRecord | null }) => {
    const { mutateAsync: saveRecord } = useSaveRecord();
    const { sites, isPending: sitesPending, error: sitesError } = useSites();
    const { providers } = useProviders();

    const form = useEntityForm({
        schema: RecordInputSchema,
        initial: () => (record ? recordDraftFrom(record) : EMPTY_RECORD_DRAFT),
        toInput: recordInputFrom,
        rules: recordRules,
    });
    const { draft, set, errors, isSaving } = form;
    const { close, leave } = useUnsavedChangesGuard(form.isDirty, record ? "record" : "newRecord");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (await form.submit((input) => saveRecord({ id: record?.id, input }))) leave();
    };

    // Only where a site of the record writes to Cloudflare -- or where it is on already, so
    // a record that left Cloudflare's sites does not hide a switch that is still set.
    const showProxied = reachesCloudflare(draft.siteIds, sites, providers) || draft.proxied;
    const error = form.saveError ?? form.formError;
    const heading = record ? `Edit ${record.name}` : "Add Record";

    return (
        <Card
            title={
                <>
                    <Globe size={18} className="text-text-muted" />
                    <HeaderBreadcrumb current={heading}>{heading}</HeaderBreadcrumb>
                </>
            }
            action={<ActionButton icon={X} tooltip="Close" onClick={close} />}
            padding="none"
        >
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
                {error && <Alert>{error}</Alert>}

                <div className="grid grid-cols-1 md:grid-cols-[1fr_8rem_1fr] gap-4">
                    <Input
                        label="Name"
                        value={draft.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="app.example.com"
                        error={errors.name}
                        hint="The full name. * as the first part stands for every name below it."
                        classNames={{ input: "font-mono" }}
                    />
                    <Select
                        label="Type"
                        value={draft.type}
                        onChange={(e) => set("type", e.target.value as RecordType)}
                        options={RECORD_TYPES.map((type) => ({ value: type, label: type }))}
                    />
                    <Input
                        label={draft.type === "CNAME" ? "Target" : "Address"}
                        value={draft.value}
                        onChange={(e) => set("value", e.target.value)}
                        placeholder={VALUE_PLACEHOLDER[draft.type]}
                        error={errors.value}
                        classNames={{ input: "font-mono" }}
                    />
                </div>

                <div>
                    <FieldLabel as="div">Sites</FieldLabel>
                    {sitesError ? (
                        <Alert title="Could not load the sites">{getErrorMessage(sitesError)}</Alert>
                    ) : sitesPending ? (
                        <LoadingIndicator label="Loading sites…" />
                    ) : sites.length === 0 ? (
                        <Alert tone="info">
                            There is no site yet. A record goes to the providers of its sites —{" "}
                            <Link to={ROUTES.siteNew} className="text-primary hover:underline">
                                add a site
                            </Link>{" "}
                            first.
                        </Alert>
                    ) : (
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {sites.map((site) => (
                                <Checkbox
                                    key={site.id}
                                    label={site.name}
                                    hint={site.description || undefined}
                                    checked={draft.siteIds.includes(site.id)}
                                    onChange={(e) => set("siteIds", toggled(draft.siteIds, site.id, e.target.checked))}
                                />
                            ))}
                        </div>
                    )}
                    {errors.siteIds && <p className="mt-1 text-xs text-error">{errors.siteIds}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                        label="TTL (Seconds)"
                        inputMode="numeric"
                        value={draft.ttl}
                        onChange={(e) => set("ttl", e.target.value)}
                        placeholder="default"
                        error={errors.ttl}
                        hint="60–86400. Empty leaves it to each provider; AdGuard Home has no TTL per record."
                    />
                    {showProxied && (
                        <div>
                            <FieldLabel htmlFor="record-proxied">Proxied by Cloudflare</FieldLabel>
                            <div className="flex h-[42px] items-center">
                                <Switch id="record-proxied" value={draft.proxied} onChange={(on) => set("proxied", on)} />
                            </div>
                        </div>
                    )}
                </div>

                <Textarea
                    label="Note"
                    rows={2}
                    value={draft.note}
                    onChange={(e) => set("note", e.target.value)}
                    error={errors.note}
                    hint="For you: what the record is for. Written to no provider."
                />

                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <Button type="button" variant="secondary" onClick={close}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" isLoading={isSaving} disabled={!form.canSave}>
                        Save
                    </Button>
                </div>
            </form>
        </Card>
    );
};
