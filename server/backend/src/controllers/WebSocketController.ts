import { FastifyInstance, FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import { WS_EVENTS } from "@dpm/shared";
import { DashboardService } from "../services/DashboardService.js";
import { ActivityService } from "../services/ActivityService.js";
import { attachHeartbeat } from "./websocket/Heartbeat.js";
import { SESSION_COOKIE } from "../services/SessionCookie.js";
import { AuthService } from "../services/AuthService.js";

export class WebSocketController {
    static async handleDashboardConnection(
        socket: WebSocket,
        req: FastifyRequest,
        fastify: FastifyInstance,
    ) {
        // Attached before the auth checks below: those close the socket and return early,
        // and attachHeartbeat registers the close handler that clears the interval.
        attachHeartbeat(socket);

        // Read from the session cookie, which the browser attaches to the handshake by itself.
        // The browser WebSocket API cannot set headers, and a token in the query string
        // would end up in every proxy and server access log along the way.
        const token: string | undefined = req.cookies?.[SESSION_COOKIE];
        if (!token) {
            socket.close(4001, "Unauthorized");
            return;
        }

        // The user is kept with the socket, so what concerns one user alone -- the seen state
        // of the activity -- can go to that user's sessions only.
        let userId: number;
        try {
            const payload = fastify.jwt.verify<{ id?: unknown; tv?: unknown }>(token);
            // Same rule as the REST hook: a deleted user or a changed password ends the
            // session, not only the token's expiry.
            if (!AuthService.isSessionCurrent(payload)) {
                socket.close(4001, "Session is no longer valid");
                return;
            }
            userId = payload.id as number;
        } catch {
            socket.close(4001, "Invalid Token");
            return;
        }

        DashboardService.addDashboardClient(socket, userId);

        // Send the initial activity list
        DashboardService.sendToDashboard(socket, {
            type: WS_EVENTS.ACTIVITY_UPDATE,
            payload: ActivityService.list(userId),
        });

        socket.on("close", () => {
            DashboardService.removeDashboardClient(socket);
        });
    }
}
