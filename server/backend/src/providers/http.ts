import http from "node:http";
import https from "node:https";

export interface HttpAnswer {
    status: number;
    body: string;
}

export interface HttpOptions {
    method?: "GET" | "POST" | "PUT";
    headers?: Record<string, string>;
    /** Sent as JSON. */
    body?: unknown;
    /** Accept a certificate this host cannot verify. Off unless the provider says so. */
    insecure?: boolean;
    timeoutMs: number;
}

/**
 * One request over HTTP or HTTPS, GET unless said otherwise. `node:https` rather than `fetch`,
 * because whether a certificate is checked is a setting of the provider, and `fetch` has no
 * way to say it per request. Throws with a sentence for a server that cannot be reached or
 * does not answer in time.
 */
export function httpRequest(url: string, { method = "GET", headers = {}, body, insecure = false, timeoutMs }: HttpOptions): Promise<HttpAnswer> {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const sent = payload === undefined ? headers : { ...headers, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(payload)) };
    return new Promise((resolve, reject) => {
        const request = transport.request(
            target,
            { method, headers: sent, timeout: timeoutMs, ...(target.protocol === "https:" ? { rejectUnauthorized: !insecure } : {}) },
            (response) => {
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => chunks.push(chunk));
                response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
                response.on("error", reject);
            },
        );
        request.on("timeout", () => request.destroy(new Error(`${target.host} did not answer within ${timeoutMs / 1000} s`)));
        request.on("error", (err) =>
            reject(
                new Error(
                    err.message.includes("did not answer") ? err.message : `${target.host} could not be reached: ${reasonOf(err)}`,
                    { cause: err },
                ),
            ),
        );
        request.end(payload);
    });
}

/**
 * Why a connection failed, in a word. A refused connection to a name with an IPv4 and an IPv6
 * address (`localhost`) fails as an AggregateError without a message; its code says it.
 */
export function reasonOf(err: Error): string {
    const code = (err as NodeJS.ErrnoException).code;
    if (err.message) return err.message;
    if (code === "ECONNREFUSED") return "connection refused";
    return code ?? "no connection";
}
