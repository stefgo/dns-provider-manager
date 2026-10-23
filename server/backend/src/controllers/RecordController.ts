import { FastifyReply, FastifyRequest } from "fastify";
import { RecordInputSchema, RecordPreviewRequestSchema, RecordSitesRequestSchema, firstIssue } from "@dpm/shared";
import { RecordRepository } from "../repositories/RecordRepository.js";
import { RecordService } from "../services/RecordService.js";
import { RequestError } from "../services/RequestError.js";
import { SyncService } from "../services/SyncService.js";
import { serviceReply } from "./serviceReply.js";

type WithId = FastifyRequest<{ Params: { recordId: string } }>;
type WithLink = FastifyRequest<{ Params: { recordId: string; providerId: string } }>;

export class RecordController {
    /** Every record, with where it stands at each of its providers. */
    static async list() {
        return SyncService.views(RecordRepository.findAll());
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

    /** Gives several records sites and takes others from them, in one go. */
    static async changeSites(request: FastifyRequest, reply: FastifyReply) {
        const parsed = RecordSitesRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        const { recordIds, add, remove } = parsed.data;
        return serviceReply(reply, () => RecordService.changeSites(recordIds, add, remove, request.user.username));
    }

    static async delete(request: WithId, reply: FastifyReply) {
        return serviceReply(reply, async () => {
            await RecordService.delete(request.params.recordId, request.user.username);
            return { success: true };
        });
    }

    /** Deletes the record in dpm and leaves what the providers hold of it as it is. */
    static async release(request: WithId, reply: FastifyReply) {
        return serviceReply(reply, () => {
            RecordService.release(request.params.recordId, request.user.username);
            return { success: true };
        });
    }

    /** What saving or deleting would do at each provider. Changes nothing. */
    static async preview(request: FastifyRequest, reply: FastifyReply) {
        const parsed = RecordPreviewRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        return serviceReply(reply, () => {
            const { id } = parsed.data;
            if (id && !RecordRepository.findById(id)) throw new RequestError(404, "Record not found");
            return SyncService.preview("record" in parsed.data ? parsed.data.record : null, id);
        });
    }

    /** Deleted records that a provider still holds. */
    static async removals() {
        return SyncService.removals();
    }

    static async sync(request: WithId, reply: FastifyReply) {
        return serviceReply(reply, () => RecordService.sync(request.params.recordId, request.user.username));
    }

    static async rewrite(request: WithLink, reply: FastifyReply) {
        const { recordId, providerId } = request.params;
        return serviceReply(reply, () => RecordService.rewrite(recordId, providerId, request.user.username));
    }

    /** Answers the record as it is now -- parked, when taking over the deletion left it without a site. */
    static async accept(request: WithLink, reply: FastifyReply) {
        const { recordId, providerId } = request.params;
        return serviceReply(reply, async () => ({ record: await RecordService.accept(recordId, providerId, request.user.username) }));
    }
}
