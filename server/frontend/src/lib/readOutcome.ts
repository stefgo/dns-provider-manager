import { plural, type Reading } from "@dpm/shared";

/** What a toast says after a reading; a failure stays until it is closed. */
export interface ReadOutcome {
    variant: "success" | "warning" | "error";
    title: string;
    description?: string;
    duration?: number;
}

/** After "Read DNS Records" on one provider: how many records it holds, or why it could not be read. */
export function readOutcome(providerName: string, reading: Pick<Reading, "error" | "recordCount">): ReadOutcome {
    if (reading.error !== null) {
        return { variant: "error", title: `Could not read ${providerName}`, description: reading.error, duration: 0 };
    }
    return { variant: "success", title: `${providerName} read`, description: plural(reading.recordCount, "record") };
}

/** After "Read Now" for every provider: how many were read, and how many could not be. */
export function readAllOutcome(result: { read?: number; failed?: number }): ReadOutcome {
    const read = result.read ?? 0;
    const failed = result.failed ?? 0;
    if (failed > 0) {
        return {
            variant: "warning",
            title: `${plural(failed, "provider")} could not be read`,
            description: `${plural(read, "provider")} read`,
            duration: 0,
        };
    }
    return { variant: "success", title: `${plural(read, "provider")} read` };
}
