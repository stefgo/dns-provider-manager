import { buildFindings, countFindings, dnsStatus, providerCount, type StatusReport } from "@dpm/shared";
import { appVersion } from "../core/version.js";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { ClusterSyncService } from "./ClusterSyncService.js";
import { SyncService } from "./SyncService.js";

/**
 * The status report of `GET /api/v1/status`: how DNS is doing and what needs a look, as the
 * dashboard shows it.
 *
 * Nothing is judged here. The inputs are what the dashboard's lists are read from -- the
 * records with their state at every provider, the providers, the sites, the removals still
 * open and how each AdGuard Home cluster keeps its nodes alike -- and the verdict and the findings come from the functions in `shared` the dashboard
 * calls, so the two cannot disagree.
 */
export class StatusService {
    static report(now = Date.now()): StatusReport {
        const records = SyncService.views(RecordRepository.findAll());
        const providers = ProviderRepository.findAll();
        const sites = SiteRepository.findAll();
        const removals = SyncService.removals();
        const clusters = ClusterSyncService.statuses();
        const findings = buildFindings({ records, providers, sites, removals, clusters }).map((finding) => ({
            id: finding.id,
            type: finding.type,
            severity: finding.severity,
            text: finding.text,
            since: null,
        }));
        return {
            app: "dpm",
            version: appVersion,
            status: dnsStatus(findings, providers),
            checkedAt: new Date(now).toISOString(),
            counts: countFindings(findings),
            summary: {
                providers: providerCount(providers),
                records: { total: records.length },
            },
            findings,
        };
    }
}
