import { useLocation, useNavigate } from "react-router-dom";
import type { Provider } from "@dpm/shared";
import { useConfirm, useToast } from "@stefgo/react-ui-components";
import { describeDeleteProvider } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { ROUTES, paths } from "../../../lib/paths";
import { readProvider, useDeleteProvider, useProviders } from "../../../queries/providers";
import { describeFailure } from "../../../utils";
import { useSites } from "../../../queries/sites";
import { ProviderList } from "./ProviderList";
import { useRecords } from "../../../queries/records";
import { recordCounts } from "../lib/providerRecords";

/** The page at `/providers`. Adding and editing happen on pages of their own. */
export const ProviderOverview = () => {
    const navigate = useNavigate();
    const { search } = useLocation();
    const { confirm } = useConfirm();
    const { providers, isPending, error } = useProviders();
    const { sites } = useSites();
    const { records } = useRecords();
    const deleteProvider = useDeleteProvider();
    const { show } = useToast();

    // What the reading found arrives through the socket. Only a request that failed is said.
    const read = (provider: Provider) =>
        readProvider(provider.id).catch((err) =>
            show({ variant: "error", ...describeFailure(`Could not read ${provider.name}`, err), duration: 0 }),
        );

    const open = (pathname: string) => navigate({ pathname, search });

    const requestDelete = (provider: Provider) =>
        confirm({ ...describeDeleteProvider(provider), onConfirm: () => deleteProvider.mutateAsync(provider.id) });

    if (error) return <QueryError title="Could not load the providers" error={error} />;

    return (
        <ProviderList
            providers={providers}
            sites={sites}
            counts={recordCounts(records)}
            isLoading={isPending}
            onAdd={() => open(ROUTES.providerNew)}
            onEdit={(provider) => open(paths.provider(provider.id))}
            onDelete={requestDelete}
            onRead={read}
        />
    );
};
