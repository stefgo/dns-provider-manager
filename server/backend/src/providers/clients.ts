import type { Provider } from "@dpm/shared";
import type { DnsProviderClient } from "./DnsProvider.js";
import { CloudflareClient } from "./cloudflare/CloudflareClient.js";

/**
 * The client that talks to a provider, with its secret in the clear. Null for a type this
 * build cannot read yet -- the provider is kept and shown, and waits for its client.
 */
export function clientFor(provider: Pick<Provider, "type">, secret: string): DnsProviderClient | null {
    switch (provider.type) {
        case "cloudflare":
            return new CloudflareClient(secret);
        case "adguard":
        case "samba-ad":
            return null;
    }
}
