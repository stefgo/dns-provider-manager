import http from "node:http";
import https from "node:https";

export interface HttpAnswer {
    status: number;
    body: string;
}

export interface HttpOptions {
    headers?: Record<string, string>;
    /** Accept a certificate this host cannot verify. Off unless the provider says so. */
    insecure?: boolean;
    timeoutMs: number;
}

/**
 * One GET over HTTP or HTTPS. `node:https` rather than `fetch`, because whether a certificate
 * is checked is a setting of the provider, and `fetch` has no way to say it per request.
 * Throws with a sentence for a server that cannot be reached or does not answer in time.
 */
export function httpGet(url: string, { headers = {}, insecure = false, timeoutMs }: HttpOptions): Promise<HttpAnswer> {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.request(
            target,
            { method: "GET", headers, timeout: timeoutMs, ...(target.protocol === "https:" ? { rejectUnauthorized: !insecure } : {}) },
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
                    err.message.includes("did not answer") ? err.message : `${target.host} could not be reached: ${err.message}`,
                    { cause: err },
                ),
            ),
        );
        request.end();
    });
}
