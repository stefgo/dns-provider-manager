import { Client, type Entry } from "ldapts";
import { normaliseDnsName } from "@dpm/shared";
import type { DnsProviderClient, ProviderEntry, ProviderZoneInfo } from "../DnsProvider.js";

const NOT_YET = "Writing to Samba AD comes with a later version of dpm";
import { entriesFromNode, sambaZoneId } from "./sambaMapping.js";
import { isSkippedZone } from "./sambaProtection.js";

/** How long connecting and each request may take. */
const TIMEOUT_MS = 10_000;

/** The LDAPS port of a domain controller named without one. */
const LDAPS_PORT = 636;

/** The LDAP result code for an object that is not there. */
const NO_SUCH_OBJECT = 32;

export interface SambaOptions {
    /** `host` or `host:port`, asked in this order. */
    servers: readonly string[];
    /** The service account, as `user@domain` or a DN. */
    username: string;
    password: string;
    allowSelfSigned: boolean;
}

/** The first value of an attribute as text, or null. */
function attr(entry: Entry | null | undefined, name: string): string | null {
    const value = entry?.[name];
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined || first === null) return null;
    const text = Buffer.isBuffer(first) ? first.toString("utf8") : String(first);
    return text === "" ? null : text;
}

/** Every value of a binary attribute, asked for as one (`explicitBufferAttributes`). */
function bytesOf(entry: Entry, name: string): Uint8Array[] {
    const value = entry[name];
    const list = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
    return list.filter((item): item is Buffer => Buffer.isBuffer(item)).map((item) => new Uint8Array(item));
}

const ldapCode = (err: unknown): number | null => {
    const code = (err as { code?: unknown } | null)?.code;
    return typeof code === "number" ? code : null;
};

/** `ldaps://host:port` for a server written `host`, `host:port` or `[v6]:port`. */
export function ldapsUrl(server: string): string {
    // A port is named by `host:port` or `[v6]:port`; a bare IPv6 address has to be bracketed.
    return /^(\[[^\]]+\]|[^:]+):\d+$/.test(server) ? `ldaps://${server}` : `ldaps://${server}:${LDAPS_PORT}`;
}

/**
 * A Samba AD domain, through LDAPS on one of its domain controllers -- the first in the list
 * that answers. The DNS zones are objects of the directory: a `dnsZone` below `CN=MicrosoftDNS`
 * in the two DNS partitions (and, in a domain upgraded from an old one, below `CN=System`),
 * each name a `dnsNode` below its zone, the records in its `dnsRecord`. Reads; writing follows with a later version.
 *
 * One connection, opened by the first call and kept until `close`.
 */
export class SambaClient implements DnsProviderClient {
    readonly zoned = true;
    private client: Client | null = null;
    private connectedTo: string | null = null;
    private zoneDns = new Map<string, string>();
    private dcNames: Set<string> | null = null;

    constructor(private readonly options: SambaOptions) {}

    /** Binds on the first domain controller that answers; says for each why it did not. */
    private async connection(): Promise<Client> {
        if (this.client) return this.client;
        const failures: string[] = [];
        for (const server of this.options.servers) {
            const client = new Client({
                url: ldapsUrl(server),
                timeout: TIMEOUT_MS,
                connectTimeout: TIMEOUT_MS,
                tlsOptions: { rejectUnauthorized: !this.options.allowSelfSigned },
            });
            try {
                await client.bind(this.options.username, this.options.password);
                this.client = client;
                this.connectedTo = server;
                return client;
            } catch (err) {
                await client.unbind().catch(() => undefined);
                const code = ldapCode(err);
                // 49: invalid credentials. Every domain controller of the domain would say the same.
                if (code === 49) throw new Error("The domain controller refused the service account or its password", { cause: err });
                failures.push(`${server}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        throw new Error(`No domain controller could be reached -- ${failures.join("; ")}`);
    }

    private async search(base: string, filter: string, attributes: string[], scope: "base" | "one" | "sub", binary: string[] = []) {
        const client = await this.connection();
        try {
            const { searchEntries } = await client.search(base, {
                scope,
                filter,
                attributes,
                explicitBufferAttributes: binary,
                ...(scope === "base" ? {} : { paged: { pageSize: 500 } }),
            });
            return searchEntries;
        } catch (err) {
            if (ldapCode(err) === NO_SUCH_OBJECT) return [];
            throw err;
        }
    }

    /** Where the zones are kept: the domain's and the forest's DNS partitions, and the old place. */
    private async zoneBases(): Promise<{ domain: string; bases: string[] }> {
        const [root] = await this.search("", "(objectClass=*)", ["defaultNamingContext", "rootDomainNamingContext"], "base");
        const domainDn = attr(root, "defaultNamingContext");
        const forestDn = attr(root, "rootDomainNamingContext") ?? domainDn;
        if (!domainDn || !forestDn) throw new Error("The directory does not name its domain");
        return {
            domain: domainDn,
            bases: [
                `CN=MicrosoftDNS,DC=DomainDnsZones,${domainDn}`,
                `CN=MicrosoftDNS,DC=ForestDnsZones,${forestDn}`,
                `CN=MicrosoftDNS,CN=System,${domainDn}`,
            ],
        };
    }

    /** The host names of the domain controllers: the accounts with SERVER_TRUST_ACCOUNT (8192). */
    private async domainControllers(domainDn: string): Promise<Set<string>> {
        if (this.dcNames) return this.dcNames;
        const entries = await this.search(
            domainDn,
            "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))",
            ["dNSHostName"],
            "sub",
        );
        this.dcNames = new Set(
            entries.map((entry) => attr(entry, "dNSHostName")).filter((n): n is string => !!n).map(normaliseDnsName),
        );
        return this.dcNames;
    }

    async test(): Promise<string> {
        const zones = await this.listZones();
        const [root] = await this.search("", "(objectClass=*)", ["dnsHostName"], "base");
        const host = attr(root, "dnsHostName") ?? this.connectedTo;
        return `Samba AD answered on ${host} and holds ${zones.length === 1 ? "1 zone" : `${zones.length} zones`}.`;
    }

    async listZones(): Promise<ProviderZoneInfo[]> {
        const { bases } = await this.zoneBases();
        const zones: ProviderZoneInfo[] = [];
        this.zoneDns = new Map();
        for (const base of bases) {
            for (const entry of await this.search(base, "(objectClass=dnsZone)", ["name"], "one")) {
                const name = attr(entry, "name");
                if (!name || isSkippedZone(name)) continue;
                const zone = { id: sambaZoneId(name), name: normaliseDnsName(name) };
                // A zone in two places keeps the first: the partitions come before the old place.
                if (this.zoneDns.has(zone.id)) continue;
                this.zoneDns.set(zone.id, entry.dn);
                zones.push(zone);
            }
        }
        return zones.sort((a, b) => a.name.localeCompare(b.name));
    }

    async listRecords(zone: ProviderZoneInfo | null): Promise<ProviderEntry[]> {
        if (!zone) return [];
        if (!this.zoneDns.has(zone.id)) await this.listZones();
        const dn = this.zoneDns.get(zone.id);
        if (!dn) return [];
        const dcs = await this.domainControllers((await this.zoneBases()).domain);
        const nodes = await this.search(dn, "(&(objectClass=dnsNode)(!(dNSTombstoned=TRUE)))", ["name", "dnsRecord"], "one", ["dnsRecord"]);
        return nodes.flatMap((node) => entriesFromNode(zone, attr(node, "name") ?? "", bytesOf(node, "dnsRecord"), dcs));
    }

    async create(): Promise<ProviderEntry> {
        throw new Error(NOT_YET);
    }

    async update(): Promise<ProviderEntry> {
        throw new Error(NOT_YET);
    }

    async delete(): Promise<void> {
        throw new Error(NOT_YET);
    }

    async close(): Promise<void> {
        const client = this.client;
        this.client = null;
        if (client) await client.unbind().catch(() => undefined);
    }
}
