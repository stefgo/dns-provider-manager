import type { To } from "react-router-dom";
import {
    buildFindings as buildSharedFindings,
    type DnsStatus,
    type Finding as SharedFinding,
    type FindingTarget,
    type FindingsInput,
} from "@dpm/shared";
import { ROUTES, paths, recordsFiltered } from "../../../lib/paths";
import { plural } from "../../../utils";

/**
 * What needs a look across the providers right now, as the dashboard's "Needs attention"
 * lists it.
 *
 * A finding is a state, not an event: it is there while the problem is, and goes by itself
 * once it is solved -- there is nothing to mark as seen. That is what tells it from a row
 * under "Errors / Warnings", which records that something happened and stays until somebody
 * has looked. Everything is read from what the cache already holds and the socket keeps current.
 *
 * Which findings there are is decided in `shared` (`buildFindings`), where the server's status
 * report reads them too; this module only turns where each leads into a link.
 */

export {
    GROUP_ABOVE,
    dnsStatus,
    isNotRead,
    isUnreachable,
    type DnsStatus,
    type FindingSeverity,
    type FindingType,
    type FindingsInput,
} from "@dpm/shared";

/** A finding as the dashboard lists it: with a link to where the reader can do something about it. */
export interface Finding extends Omit<SharedFinding, "target"> {
    to?: To;
}

/** The page a finding's target names. */
function linkTo(target: FindingTarget): To {
    switch (target.kind) {
        case "record":
            return paths.record(target.id);
        case "provider":
            return paths.provider(target.id);
        case "site":
            return paths.site(target.id);
        case "records":
            return ROUTES.records;
        case "records-problems":
            return recordsFiltered({ status: "problems" });
    }
}

/** The findings with links in place of targets. */
export function withLinks(findings: readonly SharedFinding[]): Finding[] {
    return findings.map(({ target, ...finding }) => (target ? { ...finding, to: linkTo(target) } : finding));
}

/** Everything that needs a look, as `shared` finds it, each with its link. */
export const buildFindings = (input: FindingsInput): Finding[] => withLinks(buildSharedFindings(input));

export const DNS_STATUS: Record<DnsStatus, { label: string; description: string; tone: string }> = {
    healthy: { label: "Healthy", description: "Nothing needs attention.", tone: "text-success" },
    degraded: { label: "Degraded", description: "Something needs a look.", tone: "text-warning" },
    critical: { label: "Critical", description: "Something is broken.", tone: "text-error" },
    unknown: { label: "Unknown", description: "No provider has been read yet.", tone: "text-text-muted" },
};

/** "3 findings", or what the status means where there is none. */
export function findingSummary(findings: readonly Finding[], status: DnsStatus, providerTotal: number): string {
    if (findings.length > 0) return plural(findings.length, "finding");
    if (providerTotal === 0) return "No provider yet";
    return DNS_STATUS[status].description;
}
