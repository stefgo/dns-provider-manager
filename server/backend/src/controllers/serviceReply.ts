import type { FastifyReply } from "fastify";
import { RequestError } from "../services/RequestError.js";

/**
 * Runs what a service does for a request and answers with it: its result with `status`, or
 * the status and message of a `RequestError`. Anything else is not caught -- it is a 500,
 * and Fastify logs it.
 */
export function serviceReply<T>(reply: FastifyReply, run: () => T, status = 200) {
    try {
        return reply.code(status).send(run());
    } catch (err) {
        if (err instanceof RequestError) return reply.code(err.status).send({ error: err.message });
        throw err;
    }
}
