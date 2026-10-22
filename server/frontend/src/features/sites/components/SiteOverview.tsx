import { useLocation, useNavigate } from "react-router-dom";
import type { Site } from "@dpm/shared";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteSite, describeSiteInUse } from "../confirmations";
import { siteDeletion } from "../lib/siteDeletion";
import { QueryError } from "../../../components/QueryError";
import { ROUTES, paths } from "../../../lib/paths";
import { useDeleteSite, useSites } from "../../../queries/sites";
import { useProviders } from "../../../queries/providers";
import { useRecords } from "../../../queries/records";
import { SiteList } from "./SiteList";

/** The page at `/sites`. Adding and editing happen on pages of their own. */
export const SiteOverview = () => {
    const navigate = useNavigate();
    const { search } = useLocation();
    const { confirm, alert } = useConfirm();
    const { sites, isPending, error } = useSites();
    const { providers } = useProviders();
    const { records } = useRecords();
    const deleteSite = useDeleteSite();

    const open = (pathname: string) => navigate({ pathname, search });

    // A record that belongs to this site alone blocks the deletion: said before anything is
    // asked. The server refuses the same case, which catches a record list that is stale.
    const requestDelete = (site: Site) => {
        const { alone, shared } = siteDeletion(site.id, records);
        if (alone.length > 0) {
            alert(describeSiteInUse(site, alone));
            return;
        }
        confirm({ ...describeDeleteSite(site, shared), onConfirm: () => deleteSite.mutateAsync(site.id) });
    };

    if (error) return <QueryError title="Could not load the sites" error={error} />;

    return (
        <SiteList
            sites={sites}
            providers={providers}
            isLoading={isPending}
            onAdd={() => open(ROUTES.siteNew)}
            onEdit={(site) => open(paths.site(site.id))}
            onDelete={requestDelete}
        />
    );
};
