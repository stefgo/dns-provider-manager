/**
 * Every key the cache is addressed by, in one place.
 *
 * The keys are hierarchical on purpose: `invalidateQueries({ queryKey: webhooks.all })`
 * reaches everything that comes to live under `webhooks`, because a key matches whatever it
 * is a prefix of. `queryKeys.test.ts` holds the prefix relations the code
 * relies on.
 */
export const queryKeys = {
    activity: {
        all: ["activity"] as const,
        list: () => ["activity", "list"] as const,
    },
    webhooks: {
        all: ["webhooks"] as const,
        list: () => ["webhooks", "list"] as const,
    },
    settings: {
        all: ["settings"] as const,
        schedulerStatus: () => ["settings", "scheduler-status"] as const,
    },
    users: {
        all: ["users"] as const,
        list: () => ["users", "list"] as const,
    },
};

/**
 * What the server sends by itself on every socket connect: the activity list
 * (`WebSocketController.handleDashboardConnection`).
 * After a reconnect these are current without being asked for; everything else may have
 * changed while the socket was down and is read again.
 */
const PUSHED_ON_CONNECT: readonly (readonly string[])[] = [
    queryKeys.activity.all,
];

export function isPushedOnConnect(queryKey: readonly unknown[]): boolean {
    return PUSHED_ON_CONNECT.some((prefix) => prefix.every((part, i) => queryKey[i] === part));
}
