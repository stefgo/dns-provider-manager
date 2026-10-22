import { useLocation, useNavigate } from "react-router-dom";
import type { Provider } from "@dpm/shared";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteProvider } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { ROUTES, paths } from "../../../lib/paths";
import { useDeleteProvider, useProviders } from "../../../queries/providers";
import { useSites } from "../../../queries/sites";
import { ProviderList } from "./ProviderList";

/** The page at `/providers`. Adding and editing happen on pages of their own. */
export const ProviderOverview = () => {
    const navigate = useNavigate();
    const { search } = useLocation();
    const { confirm } = useConfirm();
    const { providers, isPending, error } = useProviders();
    const { sites } = useSites();
    const deleteProvider = useDeleteProvider();

    const open = (pathname: string) => navigate({ pathname, search });

    const requestDelete = (provider: Provider) =>
        confirm({ ...describeDeleteProvider(provider), onConfirm: () => deleteProvider.mutateAsync(provider.id) });

    if (error) return <QueryError title="Could not load the providers" error={error} />;

    return (
        <ProviderList
            providers={providers}
            sites={sites}
            isLoading={isPending}
            onAdd={() => open(ROUTES.providerNew)}
            onEdit={(provider) => open(paths.provider(provider.id))}
            onDelete={requestDelete}
        />
    );
};
