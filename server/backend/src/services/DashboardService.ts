import { WebSocket } from "ws";
import { type DashboardMessage } from "@dpm/shared";

/**
 * The open dashboard sockets, and the one way anything on the server talks to them.
 *
 * Each socket is kept with the id of the user whose session opened it, so that what concerns
 * one user alone -- which events they have seen, a session that was revoked -- reaches that
 * user's sessions and nobody else's.
 */
export class DashboardService {
    /** Each dashboard socket with the id of the user whose session opened it. */
    private static dashboardClients = new Map<WebSocket, number>();

    static addDashboardClient(socket: WebSocket, userId: number) {
        this.dashboardClients.set(socket, userId);
    }

    static removeDashboardClient(socket: WebSocket) {
        this.dashboardClients.delete(socket);
    }

    /**
     * Closes every dashboard socket of a user whose sessions were just revoked.
     *
     * 4001 makes the dashboard give up instead of reconnecting (WebSocketProvider). A user
     * who changed their own password passes `renewed`: the response that did it carries a
     * fresh cookie, so their dashboard closes with 4002 and reconnects on that cookie.
     */
    static closeDashboardSessions(userId: number, renewed = false) {
        for (const [socket, owner] of this.dashboardClients) {
            if (owner !== userId) continue;
            if (renewed) {
                socket.close(4002, "Session renewed");
            } else {
                socket.close(4001, "Session is no longer valid");
            }
        }
    }

    /**
     * `DashboardMessage` and nothing else: the union in `@dpm/shared` is the contract the
     * dashboard parses against, so a shape that is not listed there does not compile here.
     */
    static sendToDashboard(socket: WebSocket, message: DashboardMessage) {
        socket.send(JSON.stringify(message));
    }

    static broadcastToDashboard(message: DashboardMessage) {
        // Serialised once for all connected dashboard sessions.
        const msgStr = JSON.stringify(message);
        for (const client of this.dashboardClients.keys()) {
            if (client.readyState === client.OPEN) {
                client.send(msgStr);
            }
        }
    }

    /**
     * Sends to every dashboard session of one user -- for what only that user's view
     * depends on, such as which events they have seen. Other users' sessions get nothing.
     */
    static sendToUser(userId: number, message: DashboardMessage) {
        const msgStr = JSON.stringify(message);
        for (const [client, owner] of this.dashboardClients) {
            if (owner === userId && client.readyState === client.OPEN) {
                client.send(msgStr);
            }
        }
    }
}
