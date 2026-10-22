import { useState } from "react";
import { useParams } from "react-router-dom";
import { Layers, X } from "lucide-react";
import { SiteInputSchema, type Site } from "@dpm/shared";
import {
    ActionButton,
    Alert,
    Button,
    Card,
    FieldLabel,
    Input,
    LoadingIndicator,
    Textarea,
    useConfirm,
} from "@stefgo/react-ui-components";
import { fetchSitePreview, useSaveSite, useSites } from "../../../queries/sites";
import { useProviders } from "../../../queries/providers";
import { QueryError } from "../../../components/QueryError";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { NotFoundError } from "../../../lib/notFound";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { getErrorMessage } from "../../../utils";
import { EMPTY_SITE_DRAFT, siteDraftFrom, siteInputFrom } from "../lib/siteForm";
import { describeSiteSync } from "../lib/siteSync";
import { SiteProviderSelect } from "./SiteProviderSelect";

/** `/sites/new` and `/sites/:siteId`, read from the list like every editor. */
export const SiteEditorRoute = () => {
    const { siteId } = useParams();
    const { sites, isPending, error } = useSites();
    const site = sites.find((s) => s.id === siteId);

    if (!siteId) return <SiteEditor site={null} />;
    if (!site && error) return <QueryError title="Could not load the site" error={error} />;
    if (!site && isPending) return <LoadingIndicator label="Loading site…" />;
    if (!site) throw new NotFoundError("site");
    return <SiteEditor key={site.id} site={site} />;
};

/**
 * Adds or edits one site: its name, and which providers give its answers. A provider may be
 * in several sites; a record goes to every provider of every site it belongs to.
 */
const SiteEditor = ({ site }: { site: Site | null }) => {
    const { mutateAsync: saveSite } = useSaveSite();
    const { providers, isPending: providersPending, error: providersError } = useProviders();
    const { confirm } = useConfirm();

    const form = useEntityForm({
        schema: SiteInputSchema,
        initial: () => (site ? siteDraftFrom(site) : EMPTY_SITE_DRAFT),
        toInput: siteInputFrom,
    });
    const { draft, set, errors, isSaving } = form;
    // The list to pick providers from takes the field's place; Escape closes it before the page.
    const [selectingProviders, setSelectingProviders] = useState(false);
    const { close, leave } = useUnsavedChangesGuard(form.isDirty, site ? "site" : "newSite", {
        onEscape: () => {
            if (!selectingProviders) return false;
            setSelectingProviders(false);
            return true;
        },
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.canSave || !form.input) return;
        // Records follow a site's providers: what that writes and removes is asked about first.
        if (site) {
            const preview = await fetchSitePreview({ id: site.id, site: form.input }).catch(() => []);
            const question = describeSiteSync(site.name, preview, providers);
            if (question && !(await confirm(question))) return;
        }
        if (await form.submit((input) => saveSite({ id: site?.id, input }))) leave();
    };

    const error = form.saveError ?? form.formError;
    const heading = site ? `Edit ${site.name}` : "Add Site";

    return (
        <Card
            title={
                <>
                    <Layers size={18} className="text-text-muted" />
                    <HeaderBreadcrumb current={heading}>{heading}</HeaderBreadcrumb>
                </>
            }
            action={<ActionButton icon={X} tooltip="Close" onClick={close} />}
            padding="none"
        >
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
                {error && <Alert>{error}</Alert>}

                <Input
                    label="Name"
                    value={draft.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="internal"
                    error={errors.name}
                />
                <Textarea
                    label="Description"
                    rows={2}
                    value={draft.description}
                    onChange={(e) => set("description", e.target.value)}
                    error={errors.description}
                    placeholder="The DNS servers of the home network"
                />

                {providersError ? (
                    <div>
                        <FieldLabel as="div">Providers</FieldLabel>
                        <Alert title="Could not load the providers">{getErrorMessage(providersError)}</Alert>
                    </div>
                ) : providersPending ? (
                    <div>
                        <FieldLabel as="div">Providers</FieldLabel>
                        <LoadingIndicator label="Loading providers…" />
                    </div>
                ) : (
                    <SiteProviderSelect
                        providers={providers}
                        selectedIds={draft.providerIds}
                        onChange={(ids) => set("providerIds", ids)}
                        isSelecting={selectingProviders}
                        onSetIsSelecting={setSelectingProviders}
                    />
                )}

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
