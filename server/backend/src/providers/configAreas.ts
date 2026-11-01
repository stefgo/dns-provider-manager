import { CONFIG_AREAS, type ConfigArea } from "@dpm/shared";
import type { ConfigAreaSync } from "./ConfigAreaSync.js";
import type { AdGuardApi } from "./adguard/AdGuardApi.js";
import { blockedServicesArea } from "./adguard/config/blockedServicesArea.js";
import { clientsArea } from "./adguard/config/clientsArea.js";
import { dnsArea } from "./adguard/config/dnsArea.js";
import { allowlistsArea, blocklistsArea } from "./adguard/config/filterListsArea.js";
import { generalArea } from "./adguard/config/generalArea.js";
import { rewritesArea } from "./adguard/config/rewritesArea.js";
import { userRulesArea } from "./adguard/config/userRulesArea.js";

/** An area whatever its state and steps, as the service handles every one alike. */
export type AnyConfigAreaSync = ConfigAreaSync<AdGuardApi, unknown, unknown>;

const AREAS: Record<ConfigArea, AnyConfigAreaSync> = {
    rewrites: rewritesArea,
    general: generalArea,
    dns: dnsArea,
    clients: clientsArea,
    blocklists: blocklistsArea,
    allowlists: allowlistsArea,
    blocked_services: blockedServicesArea,
    user_rules: userRulesArea,
};

/** How one area of an AdGuard Home cluster is read, compared and written. */
export function configAreaSync(area: ConfigArea): AnyConfigAreaSync {
    return AREAS[area];
}

/**
 * `areas` in the order a run goes through them: the order of `CONFIG_AREAS` -- blocklists
 * before allowlists, so a list that moved to the allowlists at the primary is removed from a
 * node's blocklists first.
 */
export function inRunOrder(areas: readonly ConfigArea[]): ConfigArea[] {
    return CONFIG_AREAS.filter((area) => areas.includes(area));
}
