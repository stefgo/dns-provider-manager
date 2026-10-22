import type { DnsRecord } from "@dpm/shared";
import { isProblem } from "../../records/lib/recordSync";

/** How many records go to a provider, and how many of them need a look there. */
export interface ProviderRecordCount {
    total: number;
    problems: number;
}

/** Per provider, counted from where each record stands at it. Removals under way are not counted. */
export function recordCounts(records: readonly Pick<DnsRecord, "links">[]): Map<string, ProviderRecordCount> {
    const counts = new Map<string, ProviderRecordCount>();
    for (const record of records) {
        for (const link of record.links) {
            if (link.status === "removing" && !isProblem(link)) continue;
            const count = counts.get(link.providerId) ?? { total: 0, problems: 0 };
            if (link.status !== "removing") count.total++;
            if (isProblem(link)) count.problems++;
            counts.set(link.providerId, count);
        }
    }
    return counts;
}
