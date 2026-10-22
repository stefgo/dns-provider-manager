import { z } from "zod";
import { normaliseDnsName } from "@dpm/shared";
import type { ProviderEntry, RecordData } from "../DnsProvider.js";

/** A DNS rewrite as AdGuard Home's `GET /control/rewrite/list` returns it. */
export interface AdGuardRewrite {
    domain: string;
    answer: string;
    /** Only in newer versions; a rewrite without it is enabled. */
    enabled?: boolean;
}

/**
 * What a rewrite is told apart by. AdGuard Home gives it no id, only its domain and answer, and
 * finds it for a change or a deletion only by both exactly as it keeps them -- a trailing dot
 * included. Kept as a JSON pair, since a domain written by hand may hold a space.
 */
export const rewriteId = (rewrite: Pick<AdGuardRewrite, "domain" | "answer">) => JSON.stringify([rewrite.domain, rewrite.answer]);

/** The domain and answer an id names, or null for one that is not a rewrite's. */
export function rewriteOf(id: string): { domain: string; answer: string } | null {
    try {
        const value: unknown = JSON.parse(id);
        if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string")) {
            return { domain: value[0] as string, answer: value[1] as string };
        }
    } catch {
        // Not a pair: no rewrite of ours.
    }
    return null;
}

/** The rewrite dpm writes for a record: AdGuard Home knows only its name and its answer. */
export const rewriteFor = (record: RecordData) => ({ domain: record.name, answer: record.value });

/**
 * A rewrite as an entry, or null for one that is no record: an answer of `A` or `AAAA` is
 * AdGuard Home's "answer this type from upstream". A disabled rewrite is an entry that answers
 * nothing (`disabled`). The type follows from the answer: an IPv4 address is an A record, an
 * IPv6 address an AAAA record, a name a CNAME.
 */
export function entryFromRewrite(rewrite: AdGuardRewrite): ProviderEntry | null {
    const answer = rewrite.answer.trim();
    if (answer === "" || answer.toUpperCase() === "A" || answer.toUpperCase() === "AAAA") return null;
    const common = {
        externalId: rewriteId(rewrite),
        zoneId: null,
        zone: null,
        name: normaliseDnsName(rewrite.domain),
        ttl: null,
        proxied: false,
        disabled: rewrite.enabled === false,
    };
    if (z.ipv4().safeParse(answer).success) return { ...common, type: "A", value: answer };
    if (z.ipv6().safeParse(answer).success) return { ...common, type: "AAAA", value: answer.toLowerCase() };
    return { ...common, type: "CNAME", value: normaliseDnsName(answer) };
}

/**
 * The oldest AdGuard Home dpm writes to: `PUT /control/rewrite/update` answers from v0.107.33
 * on (tried against the images; its API changelog files it under v0.107.30). `enabled` on a
 * rewrite and the switch for all rewrites came with v0.107.68; an older version ignores the
 * field.
 */
export const MIN_VERSION = [0, 107, 33] as const;
const ENABLED_FIELD_VERSION = [0, 107, 68] as const;

/** `v0.107.79` → [0, 107, 79]; null for what does not read as a version (`dev`, a build hash). */
export function parseVersion(text: string): number[] | null {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
    return match ? match.slice(1).map(Number) : null;
}

const atLeast = (version: readonly number[], minimum: readonly number[]) => {
    for (let i = 0; i < minimum.length; i++) {
        if (version[i] !== minimum[i]) return version[i] > minimum[i];
    }
    return true;
};

/** Why dpm cannot write to this version, or null. A version that does not read is let through. */
export function versionError(text: string): string | null {
    const version = parseVersion(text);
    if (!version || atLeast(version, MIN_VERSION)) return null;
    return `AdGuard Home ${text} is too old: dpm needs v${MIN_VERSION.join(".")} or later`;
}

/** Whether the version has the global switch for all rewrites (`/control/rewrite/settings`). */
export function hasRewriteSettings(text: string): boolean {
    const version = parseVersion(text);
    return version !== null && atLeast(version, ENABLED_FIELD_VERSION);
}
