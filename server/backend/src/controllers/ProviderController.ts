import { FastifyReply, FastifyRequest } from "fastify";
import { ProviderInputSchema, ProviderTestRequestSchema, firstIssue } from "@dpm/shared";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ProviderService } from "../services/ProviderService.js";
import { ProviderReadService } from "../services/ProviderReadService.js";
import { RequestError } from "../services/RequestError.js";
import { serviceReply } from "./serviceReply.js";

type WithId = FastifyRequest<{ Params: { providerId: string } }>;

export class ProviderController {
    static async list() {
        return ProviderRepository.findAll();
    }

    static async create(request: FastifyRequest, reply: FastifyReply) {
        const parsed = ProviderInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () => ProviderService.create(parsed.data, request.user.username), 201);
    }

    static async update(request: WithId, reply: FastifyReply) {
        const parsed = ProviderInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () =>
            ProviderService.update(request.params.providerId, parsed.data, request.user.username),
        );
    }

    static async delete(request: WithId, reply: FastifyReply) {
        return serviceReply(reply, () => {
            ProviderService.delete(request.params.providerId, request.user.username);
            return { success: true };
        });
    }

    /** Whether a provider as the editor holds it answers. Changes nothing. */
    static async test(request: FastifyRequest, reply: FastifyReply) {
        const parsed = ProviderTestRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        try {
            return await ProviderReadService.test(parsed.data.provider, parsed.data.id);
        } catch (err) {
            if (err instanceof RequestError) return reply.code(err.status).send({ error: err.message });
            throw err;
        }
    }

    /** Reads one provider now and answers how it went. */
    static async read(request: WithId, reply: FastifyReply) {
        if (!ProviderRepository.findById(request.params.providerId)) {
            return reply.code(404).send({ error: "Provider not found" });
        }
        await ProviderReadService.read(request.params.providerId);
        return ProviderReadService.readings().find((r) => r.providerId === request.params.providerId);
    }

    /** Reads every provider now, as a run of the scheduler. */
    static async readAll() {
        const result = await ProviderReadService.run("manual");
        return { success: true, ...result };
    }
}
