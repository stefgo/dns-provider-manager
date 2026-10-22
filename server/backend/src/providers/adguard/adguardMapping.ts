import { z } from "zod";
import { normaliseDnsName } from "@dpm/shared";
import type { ProviderEntry } from "../DnsProvider.js";

/** A DNS rewrite as AdGuard Home's `GET /control/rewrite/list` returns it. */
export interface AdGuardRewrite {
    domain: string;
    answer: string;
    /** Only in newer versions; a rewrite without it is enabled. */
    enabled?: boolean;
}

/** What a rewrite is told apart by: AdGuard Home gives it no id, only its name and answer. */
export const rewriteId = (rewrite: Pick<AdGuardRewrite, "domain" | "answer">) => `${rewrite.domain} ${rewrite.answer}`;

/**
 * A rewrite as an entry, or null for one dpm leaves alone: a disabled one, which answers
 * nothing, and one whose answer is `A` or `AAAA` -- AdGuard Home's "answer this type from
 * upstream", which is no record. The type follows from the answer: an IPv4 address is an A
 * record, an IPv6 address an AAAA record, a name a CNAME.
 */
export function entryFromRewrite(rewrite: AdGuardRewrite): ProviderEntry | null {
    if (rewrite.enabled === false) return null;
    const answer = rewrite.answer.trim();
    if (answer === "" || answer.toUpperCase() === "A" || answer.toUpperCase() === "AAAA") return null;
    const common = {
        externalId: rewriteId(rewrite),
        zoneId: null,
        zone: null,
        name: normaliseDnsName(rewrite.domain),
        ttl: null,
        proxied: false,
    };
    if (z.ipv4().safeParse(answer).success) return { ...common, type: "A", value: answer };
    if (z.ipv6().safeParse(answer).success) return { ...common, type: "AAAA", value: answer.toLowerCase() };
    return { ...common, type: "CNAME", value: normaliseDnsName(answer) };
}
