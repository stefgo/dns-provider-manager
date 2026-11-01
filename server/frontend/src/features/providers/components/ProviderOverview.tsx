import { useLocation, useNavigate } from "react-router-dom";
import type { Provider } from "@dpm/shared";
import { useConfirm, useToast } from "@stefgo/react-ui-components";
import { describeDeleteProvider } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { useReadAllProviders } from "../../../hooks/useReadAllProviders";
import { ROUTES, paths } from "../../../lib/paths";
import { readOutcome } from "../../../lib/readOutcome";
import { readProvider, useDeleteProvider, useProviders } from "../../../queries/providers";
import { describeFailure } from "../../../utils";
import { useSites } from "../../../queries/sites";
import { useClusters } from "../../../queries/clusters";
import { ProviderList } from "./ProviderList";
import { useRecords } from "../../../queries/records";
import { recordCounts } from "../lib/providerRecords";

/** The page at `/providers`. A provider's page, adding and editing are pages of their own. */
export const ProviderOverview = () => {
    const navigate = useNavigate();
    const { search } = useLocation();
    const { confirm } = useConfirm();
    const { providers, isPending, error } = useProviders();
    const { sites } = useSites();
    const { records } = useRecords();
    const { statuses: clusters } = useClusters();
    const deleteProvider = useDeleteProvider();
    const { show } = useToast();
    const { readAll, reading } = useReadAllProviders();

    // What the reading found arrives through the socket; the toast says how it went.
    const read = (provider: Provider) =>
        readProvider(provider.id)
            .then((reading) => show(readOutcome(provider.name, reading)))
            .catch((err) => show({ variant: "error", ...describeFailure(`Could not read ${provider.name}`, err), duration: 0 }));

    const open = (pathname: string) => navigate({ pathname, search });

    const requestDelete = (provider: Provider) =>
        confirm({ ...describeDeleteProvider(provider), onConfirm: () => deleteProvider.mutateAsync(provider.id) });

    if (error) return <QueryError title="Could not load the providers" error={error} />;

    return (
        <ProviderList
            providers={providers}
            sites={sites}
            counts={recordCounts(records)}
            clusters={clusters}
            isLoading={isPending}
            onAdd={() => open(ROUTES.providerNew)}
            onOpen={(provider) => open(paths.provider(provider.id))}
            onEdit={(provider) => open(paths.providerEdit(provider.id))}
            onDelete={requestDelete}
            onRead={read}
            onReadAll={readAll}
            readingAll={reading}
        />
    );
};
