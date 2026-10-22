import type { Provider } from "@dpm/shared";

/** Where a provider is: the URL, the domain controllers, or for Cloudflare its zones. */
export function providerTarget(provider: Provider): string {
    switch (provider.type) {
        case "cloudflare":
            return provider.zoneMode === "all" ? "All zones of the token" : "Selected zones";
        case "adguard":
            return provider.url;
        case "samba-ad":
            return provider.servers.join(", ");
    }
}
