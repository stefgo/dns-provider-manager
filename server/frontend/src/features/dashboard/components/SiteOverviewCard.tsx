import { Link, useNavigate } from "react-router-dom";
import { Archive, Layers, Plus } from "lucide-react";
import { Button, Card, EmptyState, FOCUS_RING, StatusDot, cn } from "@stefgo/react-ui-components";
import { ROUTES, paths, recordsFiltered } from "../../../lib/paths";
import { plural } from "../../../utils";
import { siteTileSummary, type SiteTile } from "../lib/dashboard";

const TILE = cn("block rounded-lg border border-border bg-app-bg p-4 hover:border-primary", FOCUS_RING);

/** One site: how many records it holds, its providers with how their last reading went, and its problems. */
const SiteTileLink = ({ tile }: { tile: SiteTile }) => {
    const summary = siteTileSummary(tile);
    const tone =
        tile.providers.length === 0 && tile.records > 0
            ? "text-warning"
            : tile.problems > 0
              ? tile.failed
                  ? "text-error"
                  : "text-warning"
              : "text-text-muted";
    return (
        <Link to={paths.site(tile.id)} className={TILE}>
            <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold text-text-primary">{tile.name}</span>
                <span className="shrink-0 text-xs text-text-muted">{plural(tile.records, "record")}</span>
            </div>
            {tile.providers.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                    {tile.providers.map((p) => (
                        <li key={p.id} className="flex min-w-0 items-center gap-2">
                            <StatusDot tone={p.tone} size="sm" />
                            <span className="truncate text-text-primary">{p.name}</span>
                            {!p.writable && <span className="shrink-0 text-xs text-text-muted">read only</span>}
                        </li>
                    ))}
                </ul>
            )}
            <p className={cn("mt-3 truncate text-xs", tone)} title={summary}>
                {summary}
            </p>
        </Link>
    );
};

/**
 * The sites at a glance: a tile per site, and one for the records without a site while there
 * are any. On a fresh installation it is where the first site is made -- the dashboard is the
 * first page anybody sees.
 */
export const SiteOverviewCard = ({ tiles, parked }: { tiles: readonly SiteTile[]; parked: number }) => {
    const navigate = useNavigate();
    return (
        <Card title="Sites" titleAs="h2" padding="md">
            {tiles.length === 0 ? (
                <EmptyState
                    icon={Layers}
                    title="No site yet"
                    description="A site groups the providers that give the same answers. Records are written to the providers of their sites."
                    action={
                        <Button icon={Plus} onClick={() => navigate(ROUTES.siteNew)}>
                            New site
                        </Button>
                    }
                />
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {tiles.map((tile) => (
                        <SiteTileLink key={tile.id} tile={tile} />
                    ))}
                    {parked > 0 && (
                        <Link to={recordsFiltered({ site: "parked" })} className={TILE}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="flex items-center gap-2 font-semibold text-text-primary">
                                    <Archive size={14} className="text-text-muted" /> Parked
                                </span>
                                <span className="shrink-0 text-xs text-text-muted">{plural(parked, "record")}</span>
                            </div>
                            <p className="mt-3 text-xs text-text-muted">In no site, written to no provider</p>
                        </Link>
                    )}
                </div>
            )}
        </Card>
    );
};
