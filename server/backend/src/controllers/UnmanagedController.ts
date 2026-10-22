import { FastifyReply, FastifyRequest } from "fastify";
import { AdoptRequestSchema, firstIssue } from "@dpm/shared";
import { UnmanagedService } from "../services/UnmanagedService.js";
import { serviceReply } from "./serviceReply.js";

export class UnmanagedController {
    static async list() {
        return UnmanagedService.list();
    }

    static async adopt(request: FastifyRequest, reply: FastifyReply) {
        const parsed = AdoptRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () => UnmanagedService.adopt(parsed.data.siteId, parsed.data.entries, request.user.username));
    }
}
