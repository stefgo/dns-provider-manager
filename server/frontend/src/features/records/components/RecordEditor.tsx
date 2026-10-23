import { useState } from "react";
import { useParams } from "react-router-dom";
import { Globe, X } from "lucide-react";
import { RECORD_TYPES, RecordInputSchema, type DnsRecord, type RecordType } from "@dpm/shared";
import {
    ActionButton,
    Alert,
    Button,
    Card,
    FieldLabel,
    Input,
    LoadingIndicator,
    Select,
    Textarea,
    useConfirm,
    useToast,
} from "@stefgo/react-ui-components";
import { fetchRecordPreview, useRecords, useSaveRecord } from "../../../queries/records";
import { useSites } from "../../../queries/sites";
import { useProviders } from "../../../queries/providers";
import { QueryError } from "../../../components/QueryError";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { NotFoundError } from "../../../lib/notFound";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { getErrorMessage } from "../../../utils";
import {
    EMPTY_RECORD_DRAFT,
    VALUE_PLACEHOLDER,
    recordDraftFrom,
    recordInputFrom,
    recordRules,
} from "../lib/recordForm";
import { removedAt, saveOutcome } from "../lib/recordSync";
import { describeSaveRemoving } from "../confirmations";
import { RecordProviders } from "./RecordProviders";
import { RecordSiteSelect } from "./RecordSiteSelect";

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
 * CNAME beside another record of its name -- the server says on save. TTL and Cloudflare's
 * proxy have no field: the draft carries them over from the record unchanged.
 */
const RecordEditor = ({ record }: { record: DnsRecord | null }) => {
    const { mutateAsync: saveRecord } = useSaveRecord();
    const { sites, isPending: sitesPending, error: sitesError } = useSites();
    const { providers } = useProviders();
    const { confirm } = useConfirm();
    const { show } = useToast();

    const form = useEntityForm({
        schema: RecordInputSchema,
        initial: () => (record ? recordDraftFrom(record) : EMPTY_RECORD_DRAFT),
        toInput: recordInputFrom,
        rules: recordRules,
    });
    const { draft, set, errors, isSaving } = form;
    // The list to pick sites from takes the field's place; Escape closes it before the page.
    const [selectingSites, setSelectingSites] = useState(false);
    const { close, leave } = useUnsavedChangesGuard(form.isDirty, record ? "record" : "newRecord", {
        onEscape: () => {
            if (!selectingSites) return false;
            setSelectingSites(false);
            return true;
        },
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.canSave || !form.input) return;
        // A save that takes the record off a provider is asked about first.
        if (record) {
            const preview = await fetchRecordPreview({ id: record.id, record: form.input }).catch(() => null);
            const removed = removedAt(preview, providers);
            if (removed.length > 0 && !(await confirm(describeSaveRemoving(record.name, removed)))) return;
        }
        let saved = null as DnsRecord | null;
        const stored = await form.submit(async (input) => {
            saved = await saveRecord({ id: record?.id, input });
        });
        if (!stored) return;
        // Stored either way; a provider that did not take it is said, and tried again later.
        const outcome = saved && saveOutcome(saved, providers);
        if (outcome) show({ ...outcome, duration: 0 });
        leave();
    };

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
                    />
                </div>

                {sitesError ? (
                    <div>
                        <FieldLabel as="div">Sites</FieldLabel>
                        <Alert title="Could not load the sites">{getErrorMessage(sitesError)}</Alert>
                    </div>
                ) : sitesPending ? (
                    <div>
                        <FieldLabel as="div">Sites</FieldLabel>
                        <LoadingIndicator label="Loading sites…" />
                    </div>
                ) : (
                    <RecordSiteSelect
                        sites={sites}
                        providers={providers}
                        selectedIds={draft.siteIds}
                        onChange={(ids) => set("siteIds", ids)}
                        isSelecting={selectingSites}
                        onSetIsSelecting={setSelectingSites}
                        error={errors.siteIds}
                    />
                )}

                <RecordProviders record={record} input={form.input} isDirty={form.isDirty} providers={providers} />

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
