import { useState } from "react";
import type { DnsRecord, Provider, Site } from "@dpm/shared";
import { Alert, Button, Checkbox, Modal, useToast } from "@stefgo/react-ui-components";
import { useChangeRecordSites } from "../../../queries/records";
import { getErrorMessage, nameList, plural } from "../../../utils";
import { initialSiteStates, nextSiteState, siteChanges, sitesChangePreview, sitesOutcome } from "../lib/bulkSites";

interface RecordSitesDialogProps {
    records: DnsRecord[];
    sites: Site[];
    providers: Provider[];
    onClose: () => void;
    /** After the server answered: the records changed, or were refused. */
    onDone: () => void;
}

/**
 * Gives several records sites and takes others from them. Each site's box starts as the
 * records are: ticked where all of them have it, empty where none does, half where some do.
 * Only a box that is changed changes the records; a half one left alone leaves each record
 * as it is. Below, what saving would do at the providers.
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
            title={`Change sites of ${plural(records.length, "record")}`}
            description="Tick a site to give it to every record, untick it to take it from every one. A half-ticked site is one only some of them have."
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
                {sites.length === 0 ? (
                    <Alert tone="info">There is no site yet.</Alert>
                ) : (
                    <div className="space-y-2">
                        {sites.map((site) => (
                            <Checkbox
                                key={site.id}
                                label={site.name}
                                hint={site.description || undefined}
                                checked={states[site.id] === "all"}
                                indeterminate={states[site.id] === "some"}
                                onChange={() => toggle(site.id)}
                            />
                        ))}
                    </div>
                )}
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
