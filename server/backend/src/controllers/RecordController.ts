import { FastifyReply, FastifyRequest } from "fastify";
import { RecordInputSchema, firstIssue } from "@dpm/shared";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { RecordService } from "../services/RecordService.js";
import { serviceReply } from "./serviceReply.js";

type WithId = FastifyRequest<{ Params: { recordId: string } }>;

export class RecordController {
    static async list() {
        return RecordRepository.findAll();
    }

    static async create(request: FastifyRequest, reply: FastifyReply) {
        const parsed = RecordInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () => RecordService.create(parsed.data, request.user.username), 201);
    }

    static async update(request: WithId, reply: FastifyReply) {
        const parsed = RecordInputSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () =>
            RecordService.update(request.params.recordId, parsed.data, request.user.username),
        );
    }

    static async delete(request: WithId, reply: FastifyReply) {
        return serviceReply(reply, () => {
            RecordService.delete(request.params.recordId, request.user.username);
            return { success: true };
        });
    }
}
