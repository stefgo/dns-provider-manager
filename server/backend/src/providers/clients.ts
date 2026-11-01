import type { Provider } from "@dpm/shared";
import type { DnsProviderClient } from "./DnsProvider.js";
import { AdGuardApi } from "./adguard/AdGuardApi.js";
import { AdGuardClient } from "./adguard/AdGuardClient.js";
import { AdGuardClusterClient, type ClusterOptions } from "./adguard/AdGuardClusterClient.js";
import { CloudflareClient } from "./cloudflare/CloudflareClient.js";
import { SambaClient } from "./samba/SambaClient.js";

/**
 * What a client needs of a provider: its type and the settings of that type. A cluster brings
 * its nodes with their passwords, since it has none of its own.
 */
export type ClientSettings =
    | { type: "cloudflare" }
    | { type: "adguard"; url: string; username: string; allowSelfSigned: boolean }
    | ({ type: "adguard-cluster" } & ClusterOptions)
    | { type: "samba-ad"; servers: readonly string[]; username: string; allowSelfSigned: boolean };

/** A provider as the API shows it, of a type whose secret is its own. */
type SingleProvider = Exclude<Provider, { type: "adguard-cluster" }>;

/**
 * The client that talks to a provider, with its secret in the clear -- for a cluster the
 * passwords are in its settings, and `secret` is not used. Close it after use.
 */
export function clientFor(provider: ClientSettings | SingleProvider, secret: string): DnsProviderClient {
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
        case "adguard-cluster":
            return new AdGuardClusterClient(provider);
        case "samba-ad":
            return new SambaClient({
                servers: provider.servers,
                username: provider.username,
                password: secret,
                allowSelfSigned: provider.allowSelfSigned,
            });
    }
}

/** The API of one AdGuard Home node, for what a cluster keeps alike besides the records. */
export function adguardApiFor(node: { url: string; username: string; allowSelfSigned: boolean }, password: string): AdGuardApi {
    return new AdGuardApi({ url: node.url, username: node.username, password, allowSelfSigned: node.allowSelfSigned });
}
