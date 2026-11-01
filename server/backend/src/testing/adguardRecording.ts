import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AdGuardApi } from "../providers/adguard/AdGuardApi.js";
import type { HttpOptions } from "../providers/http.js";

/**
 * What two AdGuard Home versions answered, recorded from the images (`adguard/<version>.json`):
 * v0.107.79, the newest tried, and v0.107.33, the oldest dpm writes to. Keyed by path; the
 * answers are as they came, with long lists shortened (the services, the clients AdGuard Home
 * found by itself).
 *
 * Both instances were set up alike: two clients ("TV" with every setting, "Bare" with one
 * address), the default blocklists plus one renamed and switched off, one allowlist, two custom
 * rules, protection paused, and in v0.107.79 a blocked-services schedule.
 */
export type RecordedVersion = "v0.107.79" | "v0.107.33";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "adguard");

export function recorded(version: RecordedVersion): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${version}.json`), "utf8"));
}

export interface Write {
    method: string;
    path: string;
    body: unknown;
    timeoutMs: number;
}

/**
 * An `AdGuardApi` that answers a GET from `answers` and takes every other call, which it
 * remembers in `writes`. A path it has no answer for is a 404, as AdGuard Home's own.
 */
export function answeringApi(answers: Record<string, unknown>, refuse: Record<string, string> = {}): { api: AdGuardApi; writes: Write[] } {
    const writes: Write[] = [];
    const request = async (url: string, options: HttpOptions) => {
        const at = new URL(url).pathname;
        const method = options.method ?? "GET";
        if (method === "GET") {
            return at in answers ? { status: 200, body: JSON.stringify(answers[at]) } : { status: 404, body: "404 page not found" };
        }
        if (at in refuse) return { status: 400, body: refuse[at] };
        writes.push({ method, path: at, body: options.body, timeoutMs: options.timeoutMs });
        return { status: 200, body: "OK" };
    };
    const api = new AdGuardApi({ url: "http://10.0.0.2:3000", username: "admin", password: "pw", allowSelfSigned: false }, request);
    return { api, writes };
}
