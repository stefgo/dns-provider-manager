import type { ConfigAreaSync } from "../../ConfigAreaSync.js";
import { canonicalEqual } from "../../configState.js";
import type { AdGuardApi } from "../AdGuardApi.js";
import { listed, normaliseSchedule, objectOf, scheduleForApi, sortedList, type JsonObject } from "./shapes.js";

/**
 * *Filters → Blocked services*: which services are blocked for every client, and the schedule
 * that pauses the blocking. Each version knows its own list of services; one the copy does not
 * know is refused before anything is written, with its name.
 */
export interface BlockedServicesState {
    ids: string[];
    schedule: JsonObject;
}

export type BlockedServicesStep = { kind: "set"; value: BlockedServicesState };

export const blockedServicesArea: ConfigAreaSync<AdGuardApi, BlockedServicesState, BlockedServicesStep> = {
    area: "blocked_services",
    // `GET /control/blocked_services/get` and the schedule came with v0.107.37 (tried against the images).
    minVersion: "v0.107.37",

    read(api) {
        return api.json("/control/blocked_services/get");
    },

    normalise(raw) {
        const answer = objectOf(raw, "blocked services");
        return { ids: sortedList(answer.ids), schedule: normaliseSchedule(answer.schedule) };
    },

    diff(target, current) {
        return canonicalEqual(target, current) ? [] : [{ kind: "set", value: target }];
    },

    async apply(api, steps) {
        for (const { value } of steps) {
            const known = await knownServices(api);
            const unknown = value.ids.filter((id) => !known.has(id));
            if (unknown.length > 0) {
                throw new Error(`This AdGuard Home does not know the blocked services ${listed(unknown)}; update it to the primary's version`);
            }
            await api.call("/control/blocked_services/update", "PUT", { ids: value.ids, schedule: scheduleForApi(value.schedule) });
        }
    },

    describe({ value }) {
        return value.ids.length === 0 ? "No service blocked" : `Blocked services set to ${listed(value.ids)}`;
    },
};

async function knownServices(api: AdGuardApi): Promise<Set<string>> {
    const answer = objectOf(await api.json("/control/blocked_services/all"), "list of services");
    const services = Array.isArray(answer.blocked_services) ? answer.blocked_services : [];
    return new Set(
        services
            .map((service) => (service !== null && typeof service === "object" && !Array.isArray(service) ? service.id : null))
            .filter((id): id is string => typeof id === "string"),
    );
}
