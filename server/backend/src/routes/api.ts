import { FastifyInstance } from "fastify";
import { AuthController } from "../controllers/AuthController.js";
import { UserController } from "../controllers/UserController.js";
import { SettingsController } from "../controllers/SettingsController.js";
import { RecordController } from "../controllers/RecordController.js";
import { SiteController } from "../controllers/SiteController.js";
import { ProviderController } from "../controllers/ProviderController.js";
import { UnmanagedController } from "../controllers/UnmanagedController.js";
import { ActivityController } from "../controllers/ActivityController.js";
import { WebhookController } from "../controllers/WebhookController.js";
import { HealthRepository } from "../repositories/HealthRepository.js";
import { AuthService } from "../services/AuthService.js";

export default async function apiRoutes(fastify: FastifyInstance) {
    /**
     * Liveness for the container's HEALTHCHECK, the CI smoke test and monitoring.
     * Unauthenticated: a probe has no session, and the answer discloses nothing.
     *
     * Under /api on purpose. index.ts answers every path outside /api with the SPA's
     * index.html and HTTP 200, so a /health route that failed to register would keep
     * "succeeding" with an HTML body. Under /api an unknown path is a 404.
     *
     * Deliberately narrow: can this process serve requests and reach its database. The DNS
     * providers are not consulted -- one unreachable provider must not mark this server as
     * broken.
     */
    fastify.get("/health", async (request, reply) => {
        try {
            HealthRepository.check();
            return { status: "ok" };
        } catch (err) {
            request.log.error({ err }, "Health check failed: database unreachable");
            return reply.code(503).send({ status: "error" });
        }
    });

    // Auth
    // The one unauthenticated endpoint that password guesses can be aimed at, and the
    // default admin/admin account exists until somebody changes it. Ten attempts per
    // quarter hour is far above what a person typing a password needs and far below
    // what guessing needs.
    fastify.post(
        "/login",
        {
            config: {
                rateLimit: { max: 10, timeWindow: "15 minutes" },
            },
        },
        AuthController.login,
    );
    // Unauthenticated on purpose: it only clears cookies, and requiring a valid session
    // would make an expired one impossible to log out of.
    fastify.post("/auth/logout", AuthController.logout);
    fastify.get("/auth/config", AuthController.getConfig);
    fastify.get("/auth/login", AuthController.oidcLogin);
    fastify.get("/auth/callback", AuthController.oidcCallback);

    // Register /api/v1 routes
    fastify.register(
        async (v1) => {
            // Protected Routes
            v1.register(async (protectedRoutes) => {
                protectedRoutes.addHook("onRequest", async (request, reply) => {
                    try {
                        await request.jwtVerify();
                    } catch (err) {
                        return reply.send(err);
                    }
                    // A valid signature is not enough: the user may have been deleted or
                    // had their password changed since the token was signed.
                    if (!AuthService.isSessionCurrent(request.user)) {
                        return reply
                            .code(401)
                            .send({ error: "Session is no longer valid" });
                    }
                });

                // The session's own identity. Behind the JWT hook like everything else here,
                // so an expired session answers 401 and the UI logs out through the same
                // path as for any other call.
                protectedRoutes.get("/me", AuthController.me);

                // Users
                protectedRoutes.get("/users", UserController.list);
                protectedRoutes.post("/users", UserController.create);
                protectedRoutes.put("/users/:userId", UserController.update);
                protectedRoutes.delete("/users/:userId", UserController.delete);

                // DNS -- the records, the sites they belong to and the providers a site writes to.
                protectedRoutes.get("/records", RecordController.list);
                protectedRoutes.post("/records", RecordController.create);
                protectedRoutes.put("/records/:recordId", RecordController.update);
                protectedRoutes.delete("/records/:recordId", RecordController.delete);
                protectedRoutes.get("/sites", SiteController.list);
                protectedRoutes.post("/sites", SiteController.create);
                protectedRoutes.put("/sites/:siteId", SiteController.update);
                protectedRoutes.delete("/sites/:siteId", SiteController.delete);
                protectedRoutes.get("/providers", ProviderController.list);
                protectedRoutes.post("/providers", ProviderController.create);
                // Registered before /providers/:providerId, which they would otherwise look like.
                protectedRoutes.post("/providers/test", ProviderController.test);
                protectedRoutes.post("/providers/read", ProviderController.readAll);
                protectedRoutes.post("/providers/:providerId/read", ProviderController.read);
                protectedRoutes.put("/providers/:providerId", ProviderController.update);
                protectedRoutes.delete("/providers/:providerId", ProviderController.delete);
                protectedRoutes.get("/unmanaged", UnmanagedController.list);
                protectedRoutes.post("/unmanaged/adopt", UnmanagedController.adopt);

                // Settings
                protectedRoutes.get(
                    "/settings/cleanup",
                    SettingsController.getSettings,
                );
                protectedRoutes.put(
                    "/settings/cleanup",
                    SettingsController.updateSettings,
                );
                protectedRoutes.get(
                    "/settings/scheduler-status",
                    SettingsController.getSchedulerStatus,
                );
                protectedRoutes.post(
                    "/settings/cleanup/notifications",
                    SettingsController.runNotificationCleanup,
                );

                // Activity -- what happened to the records, the providers and the server.
                protectedRoutes.get("/activity", ActivityController.list);
                protectedRoutes.post("/activity/seen", ActivityController.markManySeen);
                protectedRoutes.delete("/activity", ActivityController.deleteAll);

                // Webhooks -- where events are reported to outside of the dashboard.
                protectedRoutes.get("/webhooks", WebhookController.list);
                protectedRoutes.post("/webhooks", WebhookController.create);
                // Registered before /webhooks/:webhookId, which it would otherwise look like.
                protectedRoutes.post("/webhooks/test", WebhookController.test);
                protectedRoutes.put("/webhooks/:webhookId", WebhookController.update);
                protectedRoutes.delete("/webhooks/:webhookId", WebhookController.delete);
            });

        },
        { prefix: "/v1" },
    );
}
