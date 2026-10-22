import { useState } from "react";
import { Link } from "react-router-dom";
import type { Provider, Site, UnmanagedEntry } from "@dpm/shared";
import { Alert, Button, Modal, Select, useToast } from "@stefgo/react-ui-components";
import { useAdopt } from "../../../queries/unmanaged";
import { ROUTES } from "../../../lib/paths";
import { getErrorMessage, nameList, plural } from "../../../utils";
import { adoptOutcome, adoptableSites, alsoWrittenTo } from "../lib/adopt";

interface AdoptDialogProps {
    entries: UnmanagedEntry[];
    sites: Site[];
    providers: Provider[];
    onClose: () => void;
    /** After the server answered: what was picked is gone from the list, or was refused. */
    onDone: () => void;
}

/**
 * Takes entries over into one site. It asks only for the site -- among those that write to
 * every provider of the entries -- and says what happens: dpm keeps them as records from now
 * on, the entries stay as they are, and the site's other providers get them written.
 */
export const AdoptDialog = ({ entries, sites, providers, onClose, onDone }: AdoptDialogProps) => {
    const choices = adoptableSites(entries, sites);
    const [siteId, setSiteId] = useState(choices[0]?.id ?? "");
    const [error, setError] = useState<string | null>(null);
    const { mutateAsync: adopt, isPending } = useAdopt();
    const { show } = useToast();

    const providerNames = [...new Set(entries.map((e) => providers.find((p) => p.id === e.providerId)?.name ?? e.providerId))];
    const others = alsoWrittenTo(entries, choices.find((s) => s.id === siteId), providers);

    const submit = async () => {
        setError(null);
        try {
            const result = await adopt({
                siteId,
                entries: entries.map(({ providerId, externalId }) => ({ providerId, externalId })),
            });
            const outcome = adoptOutcome(result);
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
            title={`Adopt ${plural(entries.length, "entry", "entries")}`}
            description={`From ${providerNames.join(", ")}. They become records of dpm; the entries there stay as they are.`}
            footer={
                <div className="flex justify-end gap-3">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={submit} isLoading={isPending} disabled={!siteId || isPending}>
                        Adopt
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                {error && <Alert>{error}</Alert>}
                {choices.length === 0 ? (
                    <Alert tone="info">
                        No site writes to {providerNames.length === 1 ? providerNames[0] : `all of ${providerNames.join(", ")}`}.{" "}
                        <Link to={ROUTES.siteNew} className="text-primary hover:underline">
                            Add a site
                        </Link>{" "}
                        with {providerNames.length === 1 ? "it" : "them"} first.
                    </Alert>
                ) : (
                    <Select
                        label="Site"
                        value={siteId}
                        onChange={(e) => setSiteId(e.target.value)}
                        options={choices.map((site) => ({ value: site.id, label: site.name }))}
                        hint="Only sites that write to the entries' provider. A record can get more sites afterwards."
                    />
                )}
                {others.length > 0 && (
                    <Alert tone="info">
                        The site also writes to {nameList(others)}: {entries.length === 1 ? "the record is" : "the records are"} written
                        there after adopting.
                    </Alert>
                )}
            </div>
        </Modal>
    );
};
