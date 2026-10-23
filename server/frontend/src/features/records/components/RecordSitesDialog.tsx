import { useState } from "react";
import { Link } from "react-router-dom";
import type { DnsRecord, Provider, Site } from "@dpm/shared";
import { Alert, Button, Modal, useToast } from "@stefgo/react-ui-components";
import { MultiSelectField } from "../../../components/MultiSelectField";
import { ROUTES } from "../../../lib/paths";
import { useChangeRecordSites } from "../../../queries/records";
import { getErrorMessage, nameList, plural } from "../../../utils";
import { initialSiteStates, nextSiteState, siteChanges, sitesChangePreview, sitesOutcome } from "../lib/bulkSites";
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
 * a half one left alone leaves each record as it is. Below, what saving would do at the
 * providers.
 */
export const RecordSitesDialog = ({ records, sites, providers, onClose, onDone }: RecordSitesDialogProps) => {
    const [initial] = useState(() => initialSiteStates(records, sites));
    const [states, setStates] = useState(initial);
    const [error, setError] = useState<string | null>(null);
    const { mutateAsync: changeSites, isPending } = useChangeRecordSites();
    const { show } = useToast();

    const { add, remove } = siteChanges(states, initial);
    const preview = sitesChangePreview(records, sites, providers, add, remove);
    const asked = add.length > 0 || remove.length > 0;

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
                    <Button variant="primary" onClick={submit} isLoading={isPending} disabled={!asked || preview.changed === 0 || isPending}>
                        Save
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                {error && <Alert>{error}</Alert>}
                <MultiSelectField
                    items={sites}
                    selectedIds={sites.filter((site) => states[site.id] === "all").map((site) => site.id)}
                    partialIds={sites.filter((site) => states[site.id] === "some").map((site) => site.id)}
                    onToggle={(site) => toggle(site.id)}
                    label="Sites"
                    renderName={(site) => <SiteName site={site} />}
                    renderInfo={(site) => <SiteInfo site={site} providers={providers} />}
                    removeTooltip="Remove from Records"
                    noneSelected="No site selected: the records are parked and written to no provider"
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
                {asked && (
                    <Alert tone="info">
                        {preview.changed === 0
                            ? "Every record has its sites like this already."
                            : `${plural(preview.changed, "record")} will change${preview.unchanged > 0 ? `, ${preview.unchanged} ${preview.unchanged === 1 ? "has its" : "have their"} sites like this already` : ""}.`}
                        {preview.writtenTo.length > 0 && ` Written to ${nameList(preview.writtenTo)}.`}
                    </Alert>
                )}
                {preview.removedFrom.length > 0 && (
                    <Alert tone="warning">Removed from {nameList(preview.removedFrom)} once the other providers of each record hold it.</Alert>
                )}
                {preview.parked > 0 && (
                    <Alert tone="warning">
                        {preview.parked === 1 ? "1 record is" : `${preview.parked} records are`} left without a site: parked, and written to no
                        provider.
                    </Alert>
                )}
            </div>
        </Modal>
    );
};
