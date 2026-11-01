import type { ConfigAreaSync } from "../../ConfigAreaSync.js";
import { canonicalEqual } from "../../configState.js";
import type { AdGuardApi } from "../AdGuardApi.js";
import { mergeOver, normaliseSchedule, objectOf, scheduleForApi, sortedList, stringList, type JsonObject } from "./shapes.js";

/**
 * *Settings → Client settings*: the clients set up by hand, each with all its settings. Those
 * AdGuard Home finds by itself (`auto_clients`, from ARP, rDNS, `/etc/hosts`) belong to the
 * instance and are left alone.
 *
 * AdGuard Home has no id of its own for a client: a client is told by its name, and a client
 * renamed at the primary is removed at the copy and added anew.
 */
export interface ClientsState {
    /** By name. */
    clients: JsonObject[];
}

export type ClientsStep =
    | { kind: "delete"; name: string }
    | { kind: "update"; name: string; client: JsonObject }
    | { kind: "add"; client: JsonObject };

const nameOf = (client: JsonObject) => client.name as string;

function normaliseClient(raw: unknown): JsonObject {
    const client = { ...objectOf(raw, "client") };
    // The old single switch for Safe Search, a copy of `safe_search.enabled` in every version dpm writes to.
    delete client.safesearch_enabled;
    client.ids = sortedList(client.ids);
    client.tags = sortedList(client.tags);
    client.blocked_services = sortedList(client.blocked_services);
    client.upstreams = stringList(client.upstreams);
    if ("blocked_services_schedule" in client) client.blocked_services_schedule = normaliseSchedule(client.blocked_services_schedule);
    return client;
}

/** A client as AdGuard Home takes it. */
function forApi(client: JsonObject): JsonObject {
    const out = { ...client };
    if ("blocked_services_schedule" in out) out.blocked_services_schedule = scheduleForApi(out.blocked_services_schedule);
    return out;
}

export const clientsArea: ConfigAreaSync<AdGuardApi, ClientsState, ClientsStep> = {
    area: "clients",
    minVersion: null,

    read(api) {
        return api.json("/control/clients");
    },

    normalise(raw) {
        const answer = objectOf(raw, "list of clients");
        const list = answer.clients === null || answer.clients === undefined ? [] : answer.clients;
        if (!Array.isArray(list)) throw new Error("AdGuard Home sent no list of clients");
        const clients = list.map(normaliseClient).filter((client) => typeof client.name === "string");
        return { clients: clients.sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0)) };
    },

    /**
     * Removals first, then changes, then additions: an id (an address, a MAC) may belong to one
     * client only, so it has to be free before another client takes it. Of the changes, those
     * that take no id another client holds go first, for the same reason.
     */
    diff(target, current) {
        const wanted = new Map(target.clients.map((client) => [nameOf(client), client]));
        const held = new Map(current.clients.map((client) => [nameOf(client), client]));
        const deletes: ClientsStep[] = [...held.keys()].filter((name) => !wanted.has(name)).map((name) => ({ kind: "delete", name }));
        const updates: { name: string; client: JsonObject; takesIds: boolean }[] = [];
        const adds: ClientsStep[] = [];
        for (const [name, client] of wanted) {
            const before = held.get(name);
            if (!before) adds.push({ kind: "add", client });
            else if (!canonicalEqual(client, before)) {
                const had = new Set(stringList(before.ids));
                updates.push({ name, client, takesIds: stringList(client.ids).some((id) => !had.has(id)) });
            }
        }
        updates.sort((a, b) => Number(a.takesIds) - Number(b.takesIds));
        return [...deletes, ...updates.map(({ name, client }): ClientsStep => ({ kind: "update", name, client })), ...adds];
    },

    async apply(api, steps) {
        // The copy's own clients, as the base a change is written over: a field the cluster does not
        // compare keeps the copy's value.
        let held: Map<string, JsonObject> | null = null;
        for (const step of steps) {
            switch (step.kind) {
                case "delete":
                    await api.call("/control/clients/delete", "POST", { name: step.name });
                    break;
                case "update": {
                    held ??= await heldClients(api);
                    const data = mergeOver(held.get(step.name), forApi(step.client)) as JsonObject;
                    delete data.safesearch_enabled;
                    await api.call("/control/clients/update", "POST", { name: step.name, data });
                    break;
                }
                case "add":
                    await api.call("/control/clients/add", "POST", forApi(step.client));
                    break;
            }
        }
    },

    describe(step) {
        switch (step.kind) {
            case "delete":
                return `Client "${step.name}" removed`;
            case "update":
                return `Client "${step.name}" changed`;
            case "add":
                return `Client "${nameOf(step.client)}" added`;
        }
    },
};

async function heldClients(api: AdGuardApi): Promise<Map<string, JsonObject>> {
    const answer = objectOf(await api.json("/control/clients"), "list of clients");
    const list = Array.isArray(answer.clients) ? answer.clients : [];
    return new Map(
        list
            .filter((client): client is JsonObject => client !== null && typeof client === "object" && !Array.isArray(client) && typeof client.name === "string")
            .map((client) => [client.name as string, client]),
    );
}
