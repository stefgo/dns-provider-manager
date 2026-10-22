import { Link, useParams } from "react-router-dom";
import { Layers, X } from "lucide-react";
import { PROVIDER_TYPE_LABELS, SiteInputSchema, type Site } from "@dpm/shared";
import {
    ActionButton,
    Alert,
    Button,
    Card,
    Checkbox,
    FieldLabel,
    Input,
    LoadingIndicator,
    Textarea,
} from "@stefgo/react-ui-components";
import { useSaveSite, useSites } from "../../../queries/sites";
import { useProviders } from "../../../queries/providers";
import { QueryError } from "../../../components/QueryError";
import { useEntityForm } from "../../../hooks/useEntityForm";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard";
import { NotFoundError } from "../../../lib/notFound";
import { ROUTES } from "../../../lib/paths";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { getErrorMessage, toggled } from "../../../utils";
import { EMPTY_SITE_DRAFT, siteDraftFrom, siteInputFrom } from "../lib/siteForm";

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

    const form = useEntityForm({
        schema: SiteInputSchema,
        initial: () => (site ? siteDraftFrom(site) : EMPTY_SITE_DRAFT),
        toInput: siteInputFrom,
    });
    const { draft, set, errors, isSaving } = form;
    const { close, leave } = useUnsavedChangesGuard(form.isDirty, site ? "site" : "newSite");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
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

                <div>
                    <FieldLabel as="div">Providers</FieldLabel>
                    {providersError ? (
                        <Alert title="Could not load the providers">{getErrorMessage(providersError)}</Alert>
                    ) : providersPending ? (
                        <LoadingIndicator label="Loading providers…" />
                    ) : providers.length === 0 ? (
                        <Alert tone="info">
                            There is no provider yet. A site can be saved without one;{" "}
                            <Link to={ROUTES.providerNew} className="text-primary hover:underline">
                                add a provider
                            </Link>{" "}
                            and come back to give it this site.
                        </Alert>
                    ) : (
                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {providers.map((provider) => (
                                <Checkbox
                                    key={provider.id}
                                    label={provider.name}
                                    hint={PROVIDER_TYPE_LABELS[provider.type]}
                                    checked={draft.providerIds.includes(provider.id)}
                                    onChange={(e) =>
                                        set("providerIds", toggled(draft.providerIds, provider.id, e.target.checked))
                                    }
                                />
                            ))}
                        </div>
                    )}
                    <p className="mt-1 text-xs text-text-muted">
                        Every record of this site goes to each provider ticked here.
                    </p>
                </div>

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
