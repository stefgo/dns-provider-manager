import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Globe, Server, ShieldCheck } from "lucide-react";
import { Card, StatCard } from "@stefgo/react-ui-components";
import { QueryError } from "../../../components/QueryError";
import { useActivity } from "../../../queries/activity";
import { useProviders } from "../../../queries/providers";
import { useRecords } from "../../../queries/records";
import { useSites } from "../../../queries/sites";
import { ActivityView } from "../../activity/components/ActivityView";
import { ROUTES, SEARCH_PARAM, recordsFiltered } from "../../../lib/paths";
import { EMPTY_VALUE } from "../../../utils";
import {
    formatReachable,
    problemSummary,
    providerCount,
    providerSummary,
    recordSummary,
    recordSummaryText,
    siteTiles,
    unseenProblems,
} from "../lib/dashboard";
import { DNS_STATUS } from "../lib/findings";
import { useFindings } from "../hooks/useFindings";
import { FindingList } from "./FindingList";
import { SiteOverviewCard } from "./SiteOverviewCard";

/**
 * The list a card opens beneath the cards. One at a time: the lists keep their search in
 * the same `search` parameter, so two open at once would filter each other. Kept in the
 * `panel` parameter, so the open list survives a reload and travels with a shared link.
 */
const PANELS = ["activity"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_PARAM = "panel";
const PANEL_ID = "dashboard-panel";

/** An icon with nothing to say; one that has something takes the colour of what it says. */
const QUIET = "text-text-muted";

const toPanel = (value: string | null): Panel | null =>
    (PANELS as readonly (string | null)[]).includes(value) ? (value as Panel) : null;

/**
 * The landing page: how DNS is doing, and what needs a look.
 *
 * The first card is the status, by the worst finding; the findings themselves are listed
 * below the cards under "Needs attention", each the way to where it can be dealt with. A
 * finding is a state -- it goes once the problem does -- where "Errors / Warnings" counts
 * events nobody has looked at yet. The cards for providers and records lead to their lists,
 * the records with the filter that leaves what the card counted; the last one opens the
 * activity beneath the cards. At the bottom, a tile per site.
 *
 * Every number is a function of `lib/dashboard.ts`, on data the socket keeps current.
 */
export const DashboardOverview = () => {
    const navigate = useNavigate();
    const { events } = useActivity();
    const { providers, isPending: providersPending, error: providersError } = useProviders();
    const { records, isPending: recordsPending, error: recordsError } = useRecords();
    const { sites, isPending: sitesPending, error: sitesError } = useSites();
    const dns = useFindings();
    const [searchParams, setSearchParams] = useSearchParams();
    const panel = toPanel(searchParams.get(PANEL_PARAM));
    // A second click on the open card closes its list again. The search is dropped either
    // way: a name typed into one list would otherwise filter the next one to nothing.
    // One write for both: two `setSearchParams` in a row would each start from the same URL,
    // and the second would undo the first. It replaces the history entry, as the search does.
    const togglePanel = (next: Panel) => {
        setSearchParams(
            (prev) => {
                const params = new URLSearchParams(prev);
                if (toPanel(prev.get(PANEL_PARAM)) === next) {
                    params.delete(PANEL_PARAM);
                } else {
                    params.set(PANEL_PARAM, next);
                }
                params.delete(SEARCH_PARAM);
                return params;
            },
            { replace: true },
        );
    };

    const problems = useMemo(() => unseenProblems(events), [events]);
    const hosts = useMemo(() => providerCount(providers), [providers]);
    const held = useMemo(() => recordSummary(records), [records]);
    const tiles = useMemo(() => siteTiles(sites, providers, records), [sites, providers, records]);

    // Until a list has arrived, or when it could not be read, a zero would read as "nothing wrong".
    const providersKnown = !providersPending && !providersError;
    const recordsKnown = !recordsPending && !recordsError;
    const unknownSub = (pending: boolean) => (pending ? "Loading…" : "Not known");

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                    label="DNS"
                    value={DNS_STATUS[dns.status].label}
                    sub={dns.summary}
                    icon={ShieldCheck}
                    classNames={{ icon: DNS_STATUS[dns.status].tone }}
                />
                <StatCard
                    label="Providers reachable"
                    value={providersKnown ? formatReachable(hosts) : EMPTY_VALUE}
                    sub={providersKnown ? providerSummary(hosts) : unknownSub(providersPending)}
                    icon={Server}
                    onClick={() => navigate(ROUTES.providers)}
                    classNames={{ icon: providersKnown && hosts.unreachable > 0 ? "text-warning" : QUIET }}
                />
                <StatCard
                    label="Records"
                    value={recordsKnown ? String(held.total) : EMPTY_VALUE}
                    sub={recordsKnown ? recordSummaryText(held) : unknownSub(recordsPending)}
                    icon={Globe}
                    onClick={() => navigate(held.problems > 0 ? recordsFiltered({ status: "problems" }) : ROUTES.records)}
                    classNames={{
                        icon: !recordsKnown ? QUIET : held.failed ? "text-error" : held.problems > 0 ? "text-warning" : QUIET,
                    }}
                />
                <StatCard
                    label="Errors / Warnings"
                    value={String(problems.errors + problems.warnings)}
                    sub={problemSummary(problems)}
                    icon={AlertTriangle}
                    onClick={() => togglePanel("activity")}
                    selected={panel === "activity"}
                    aria-expanded={panel === "activity"}
                    classNames={{
                        icon: problems.errors > 0 ? "text-error" : problems.warnings > 0 ? "text-warning" : QUIET,
                    }}
                    aria-controls={PANEL_ID}
                />
            </div>

            {panel && (
                <div id={PANEL_ID}>
                    {panel === "activity" && <ActivityView initialLevel="warning" />}
                </div>
            )}

            {providersError && <QueryError title="Could not load the providers" error={providersError} />}
            {recordsError && <QueryError title="Could not load the records" error={recordsError} />}
            {sitesError && <QueryError title="Could not load the sites" error={sitesError} />}

            {dns.findings.length > 0 && (
                <Card title="Needs attention" titleAs="h2">
                    <FindingList findings={dns.findings} />
                </Card>
            )}

            {!sitesPending && !sitesError && <SiteOverviewCard tiles={tiles} parked={held.parked} />}
        </div>
    );
};
