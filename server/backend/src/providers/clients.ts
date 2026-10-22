import type { Provider } from "@dpm/shared";
import type { DnsProviderClient } from "./DnsProvider.js";
import { AdGuardClient } from "./adguard/AdGuardClient.js";
import { CloudflareClient } from "./cloudflare/CloudflareClient.js";
import { SambaClient } from "./samba/SambaClient.js";

/** What a client needs of a provider: its type and the settings of that type. */
export type ClientSettings =
    | { type: "cloudflare" }
    | { type: "adguard"; url: string; username: string; allowSelfSigned: boolean }
    | { type: "samba-ad"; servers: readonly string[]; username: string; allowSelfSigned: boolean };

/** The client that talks to a provider, with its secret in the clear. Close it after use. */
export function clientFor(provider: ClientSettings | Provider, secret: string): DnsProviderClient {
    switch (provider.type) {
        case "cloudflare":
            return new CloudflareClient(secret);
        case "adguard":
            return new AdGuardClient({
                url: provider.url,
                username: provider.username,
                password: secret,
                allowSelfSigned: provider.allowSelfSigned,
            });
        case "samba-ad":
            return new SambaClient({
                servers: provider.servers,
                username: provider.username,
                password: secret,
                allowSelfSigned: provider.allowSelfSigned,
            });
    }
}
