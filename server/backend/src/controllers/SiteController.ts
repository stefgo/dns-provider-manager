import { FastifyReply, FastifyRequest } from "fastify";
import { SiteInputSchema, firstIssue } from "@dpm/shared";
import { SiteRepository } from "../repositories/SiteRepository.js";
import { SiteService } from "../services/SiteService.js";
import { serviceReply } from "./serviceReply.js";

type WithId = FastifyRequest<{ Params: { siteId: string } }>;

export class SiteController {
    static async list() {
        return SiteRepository.findAll();
    }

    static async create(request: FastifyRequest, reply: FastifyReply) {
        const parsed = SiteInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () => SiteService.create(parsed.data, request.user.username), 201);
    }

    static async update(request: WithId, reply: FastifyReply) {
        const parsed = SiteInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () =>
            SiteService.update(request.params.siteId, parsed.data, request.user.username),
        );
    }

    static async delete(request: WithId, reply: FastifyReply) {
        return serviceReply(reply, () => {
            SiteService.delete(request.params.siteId, request.user.username);
            return { success: true };
        });
    }
}
