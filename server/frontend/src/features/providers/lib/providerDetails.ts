import type { Provider, ProviderZone } from "@dpm/shared";
import type { StatusDotTone } from "@stefgo/react-ui-components";
import { EMPTY_VALUE } from "../../../utils";

/** One line of a provider's details, as text: the page decides what is shown when. */
export interface ProviderDetailLine {
    label: string;
    value: string;
}

/** The dot in front of a provider's name: how its last reading went. */
export function readTone(provider: Pick<Provider, "lastError" | "lastSeenAt">): StatusDotTone {
    if (provider.lastError !== null) return "error";
    return provider.lastSeenAt ? "success" : "neutral";
}

/** The zones the provider uses, of those its last reading saw. */
export const usedZones = (provider: Pick<Provider, "id" | "zones">): ProviderZone[] =>
    provider.zones.filter((zone) => zone.owner === provider.id);

/** Where dpm reaches the provider: what tells two providers of one type apart. */
export function connectionDetails(provider: Provider): ProviderDetailLine[] {
    switch (provider.type) {
        case "cloudflare":
            return [{ label: "Zone Mode", value: provider.zoneMode === "all" ? "All zones the token sees" : "Selected zones" }];
        case "adguard":
            return [{ label: "URL", value: provider.url || EMPTY_VALUE }];
        case "samba-ad":
            return [
                {
                    label: provider.servers.length === 1 ? "Server" : "Servers",
                    value: provider.servers.join(", ") || EMPTY_VALUE,
                },
            ];
    }
}

/**
 * How dpm signs in there. A Cloudflare token is the whole of it; the others have a user and
 * a certificate dpm may or may not accept unchecked.
 */
export function accessDetails(provider: Provider): ProviderDetailLine[] {
    if (provider.type === "cloudflare") return [];
    return [
        { label: "Username", value: provider.username || EMPTY_VALUE },
        { label: "Self-Signed Certificate", value: provider.allowSelfSigned ? "Accepted" : "Refused" },
    ];
}
