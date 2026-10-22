import { FastifyReply, FastifyRequest } from "fastify";
import { ProviderInputSchema, firstIssue } from "@dpm/shared";
import { ProviderRepository } from "../repositories/ProviderRepository.js";
import { ProviderService } from "../services/ProviderService.js";
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
}
