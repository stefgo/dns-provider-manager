import { useMemo } from "react";
import { useProviders } from "../../../queries/providers";
import { useRecords, useRemovals } from "../../../queries/records";
import { useSites } from "../../../queries/sites";
import { buildFindings, dnsStatus, findingSummary } from "../lib/findings";

/**
 * The findings across the providers and the status they add up to. Only reads the cache and
 * calls `buildFindings`; the socket keeps what it reads current, so a finding comes and goes
 * with the reading or the write it is about.
 */
export function useFindings() {
    const { records, isPending: recordsPending, error: recordsError } = useRecords();
    const { providers, isPending: providersPending, error: providersError } = useProviders();
    const { sites, isPending: sitesPending, error: sitesError } = useSites();
    const removals = useRemovals();
    const isPending = recordsPending || providersPending || sitesPending;
    // A list that could not be read leaves nothing to judge by: its empty stand-in would pass for healthy.
    const failed = !!(recordsError || providersError || sitesError);

    return useMemo(() => {
        const findings = buildFindings({ records, providers, sites, removals });
        if (isPending || failed) {
            return { findings, status: "unknown" as const, summary: isPending ? "Loading…" : "Not known" };
        }
        const status = dnsStatus(findings, providers);
        return { findings, status, summary: findingSummary(findings, status, providers.length) };
    }, [records, providers, sites, removals, isPending, failed]);
}
