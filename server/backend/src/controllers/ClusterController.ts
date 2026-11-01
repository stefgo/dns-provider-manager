import { FastifyReply, FastifyRequest } from "fastify";
import { ProviderTestRequestSchema, firstIssue } from "@dpm/shared";
import { ClusterSyncService } from "../services/ClusterSyncService.js";
import { RequestError } from "../services/RequestError.js";
import { serviceReply } from "./serviceReply.js";

type WithId = FastifyRequest<{ Params: { providerId: string } }>;

/** How the AdGuard Home clusters keep their nodes alike. A cluster itself is saved as a provider. */
export class ClusterController {
    static async list() {
        return ClusterSyncService.statuses();
    }

    static async status(request: WithId, reply: FastifyReply) {
        const status = ClusterSyncService.status(request.params.providerId);
        if (!status) return reply.code(404).send({ error: "Cluster not found" });
        return status;
    }

    /** "Sync now": keeps one cluster alike now and answers how it stands after. */
    static async run(request: WithId, reply: FastifyReply) {
        if (!ClusterSyncService.status(request.params.providerId)) return reply.code(404).send({ error: "Cluster not found" });
        await ClusterSyncService.runCluster(request.params.providerId);
        return ClusterSyncService.status(request.params.providerId);
    }

    /** Every cluster now, as a run of the scheduler. */
    static async runAll() {
        const result = await ClusterSyncService.run("manual");
        return { success: true, ...result };
    }

    /** What saving a cluster as the editor holds it would write to its nodes. Changes nothing. */
    static async preview(request: FastifyRequest, reply: FastifyReply) {
        const parsed = ProviderTestRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
        const { provider, id } = parsed.data;
        return serviceReply(reply, () => {
            if (provider.type !== "adguard-cluster") throw new RequestError(400, "Only a cluster has a preview of its nodes");
            return ClusterSyncService.preview(provider, id);
        });
    }
}
