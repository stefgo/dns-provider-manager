import { httpRequest, type HttpOptions } from "../http.js";

/** How long one call may take before it counts as unanswered. */
const TIMEOUT_MS = 10_000;

export type Request = (url: string, options: HttpOptions) => ReturnType<typeof httpRequest>;

export interface AdGuardOptions {
    url: string;
    username: string;
    password: string;
    allowSelfSigned: boolean;
}

/**
 * The API of one AdGuard Home instance's web interface, with Basic Auth. Shared by what
 * reads and writes its rewrites (`AdGuardClient`) and what keeps its configuration in step
 * with a cluster's primary.
 *
 * `request` is the network, handed in so a test can answer in its place.
 */
export class AdGuardApi {
    constructor(
        readonly options: AdGuardOptions,
        private readonly request: Request = httpRequest,
    ) {}

    /**
     * One call; the body of a success as text. Throws with a sentence otherwise. `timeoutMs`
     * for a call AdGuard Home takes long over, such as adding a filter list it downloads first.
     */
    async call(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown, timeoutMs = TIMEOUT_MS): Promise<string> {
        const base = this.options.url.replace(/\/+$/, "");
        const auth = Buffer.from(`${this.options.username}:${this.options.password}`).toString("base64");
        const { status, body: text } = await this.request(`${base}${path}`, {
            method,
            body,
            headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
            insecure: this.options.allowSelfSigned,
            timeoutMs,
        });
        if (status === 401 || status === 403) {
            // After five failed logins AdGuard Home refuses every login from the address for a
            // while (`auth_attempts`, `block_auth_min`), the right password included.
            throw new Error(
                "AdGuard Home refused the user name or the password. After several failed attempts it refuses this address for a while, even with the right password.",
            );
        }
        if (status === 404) throw new Error(`AdGuard Home does not know ${path} -- is ${base} the address of its web interface?`);
        if (status < 200 || status >= 300) {
            throw new Error(`AdGuard Home refused it (HTTP ${status})${text ? `: ${text.trim().slice(0, 200)}` : ""}`);
        }
        return text;
    }

    /** A GET whose answer is JSON. */
    async json(path: string): Promise<unknown> {
        const text = await this.call(path);
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`${this.options.url} answered something that is not AdGuard Home's API`);
        }
    }

    /** The version AdGuard Home reports, such as `v0.107.79`; null when it names none. */
    async version(): Promise<string | null> {
        const status = (await this.json("/control/status")) as { version?: unknown };
        return typeof status?.version === "string" ? status.version : null;
    }
}
