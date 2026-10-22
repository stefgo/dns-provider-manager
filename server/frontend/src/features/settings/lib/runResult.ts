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
    if ("read" in result) {
        return result.failed > 0 ? `${result.read} read, ${result.failed} failed` : `${result.read} read`;
    }
    return `${result.removed} removed`;
}
