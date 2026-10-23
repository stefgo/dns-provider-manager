import { useState } from "react";
import { Link } from "react-router-dom";
import type { DnsRecord, Provider, Site } from "@dpm/shared";
import { Alert, Button, Modal, useToast } from "@stefgo/react-ui-components";
import { MultiSelectField } from "../../../components/MultiSelectField";
import { ROUTES } from "../../../lib/paths";
import { useChangeRecordSites } from "../../../queries/records";
import { getErrorMessage, plural } from "../../../utils";
import { describeSitesChange, initialSiteStates, nextSiteState, siteChanges, sitesChangePreview, sitesOutcome } from "../lib/bulkSites";
import { SiteInfo, SiteName } from "./RecordSiteSelect";

interface RecordSitesDialogProps {
    records: DnsRecord[];
    sites: Site[];
    providers: Provider[];
    onClose: () => void;
    /** After the server answered: the records changed, or were refused. */
    onDone: () => void;
}

/**
 * Gives several records sites and takes others from them, in the list the record editor picks
 * its sites from. Each site starts as the records are: ticked where all of them have it,
 * empty where none does, half where some do. Only a site that is changed changes the records;
 * a half one left alone leaves each record as it is.
 *
 * "Save" asks first, with what the change does at the providers. The question is a second
 * view of this dialog rather than a confirm on top of it: a dialog closes on a click outside
 * itself, and a second one is outside it.
 */
export const RecordSitesDialog = ({ records, sites, providers, onClose, onDone }: RecordSitesDialogProps) => {
    const [initial] = useState(() => initialSiteStates(records, sites));
    const [states, setStates] = useState(initial);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { mutateAsync: changeSites, isPending } = useChangeRecordSites();
    const { show } = useToast();

    const { add, remove } = siteChanges(states, initial);
    const preview = sitesChangePreview(records, sites, providers, add, remove);
    const siteNames = (ids: readonly string[]) => sites.filter((s) => ids.includes(s.id)).map((s) => s.name);
    const confirmation = describeSitesChange(preview, siteNames(add), siteNames(remove));

    const toggle = (id: string) => setStates((current) => ({ ...current, [id]: nextSiteState(current[id], initial[id]) }));

    const submit = async () => {
        setError(null);
        try {
            const result = await changeSites({ recordIds: records.map((r) => r.id), add, remove });
            const outcome = sitesOutcome(result);
            // A refusal is to be read, so it stays until it is dismissed.
            show({ ...outcome, duration: outcome.variant === "success" ? undefined : 0 });
            onDone();
        } catch (err) {
            setError(getErrorMessage(err));
        }
    };

    if (confirming) {
        return (
            <Modal
                isOpen
                onClose={onClose}
                size="lg"
                title={confirmation.title}
                footer={
                    <div className="flex justify-end gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => {
                                setError(null);
                                setConfirming(false);
                            }}
                            disabled={isPending}
                        >
                            Back
                        </Button>
                        <Button variant={confirmation.variant} onClick={submit} isLoading={isPending} disabled={isPending}>
                            {confirmation.confirmLabel}
                        </Button>
                    </div>
                }
            >
                <div className="space-y-4">
                    {error && <Alert>{error}</Alert>}
                    {confirmation.notes.map((note) => (
                        <Alert key={note.text} tone={note.tone}>
                            {note.text}
                        </Alert>
                    ))}
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="lg"
            title={`Change sites of ${plural(records.length, "record")}`}
            footer={
                <div className="flex justify-end gap-3">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={() => setConfirming(true)} disabled={preview.changed === 0}>
                        Save
                    </Button>
                </div>
            }
        >
            <MultiSelectField
                items={sites}
                selectedIds={sites.filter((site) => states[site.id] === "all").map((site) => site.id)}
                partialIds={sites.filter((site) => states[site.id] === "some").map((site) => site.id)}
                onToggle={(site) => toggle(site.id)}
                label="Sites"
                renderName={(site) => <SiteName site={site} />}
                renderInfo={(site) => <SiteInfo site={site} providers={providers} />}
                removeTooltip="Remove from Records"
                noneSelected="No site selected"
                emptyList={
                    <>
                        There is no site yet —{" "}
                        <Link to={ROUTES.siteNew} className="text-primary hover:underline">
                            add a site
                        </Link>{" "}
                        first.
                    </>
                }
                hint="Ticked: every record gets the site. Empty: every record loses it. Half: only some of them have it, and each keeps what it has."
            />
        </Modal>
    );
};
