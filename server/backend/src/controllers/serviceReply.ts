import type { FastifyReply } from "fastify";
import { RequestError } from "../services/RequestError.js";

/**
 * Runs what a service does for a request -- at once or awaited -- and answers with it: its
 * result with `status`, or the status and message of a `RequestError`. Anything else is not
 * caught -- it is a 500, and Fastify logs it.
 */
export async function serviceReply<T>(reply: FastifyReply, run: () => T | Promise<T>, status = 200) {
    try {
        return reply.code(status).send(await run());
    } catch (err) {
        if (err instanceof RequestError) return reply.code(err.status).send({ error: err.message });
        throw err;
    }
}
