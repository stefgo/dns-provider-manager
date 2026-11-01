import type { SchedulerRunSummary } from "@dpm/shared";

/**
 * What a scheduler's last run did, as the settings page words it. The server stores the
 * numbers; the sentence is written here, like the activity texts.
 */
export function describeRunResult(run: SchedulerRunSummary): string {
    if (run.status === "failed" || run.status === "interrupted") {
        return run.error ?? (run.status === "failed" ? "Failed" : "Interrupted");
    }
    const result = run.result;
    if (!result) return "Done";
    if ("clusters" in result) {
        const written = `${result.clusters} ${result.clusters === 1 ? "cluster" : "clusters"}, ${result.written} written`;
        return result.failed > 0 ? `${written}, ${result.failed} failed` : written;
    }
    if ("read" in result) {
        return result.failed > 0 ? `${result.read} read, ${result.failed} failed` : `${result.read} read`;
    }
    return `${result.removed} removed`;
}
