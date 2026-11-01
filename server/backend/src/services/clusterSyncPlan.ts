import type { ConfigLinkStatus } from "@dpm/shared";
import type { ConfigAreaSync } from "../providers/ConfigAreaSync.js";
import { commonShape, project, stateHash, type Shape } from "../providers/configState.js";

/**
 * What a run decides for one area of one AdGuard Home cluster: its primary is the source,
 * every other node (a copy) is made to hold what the primary holds.
 *
 * Pure: the service reads the primary and the copies, hands in their hashes and what it
 * remembers, and does what the plan says.
 */

/**
 * How reading the area went at one node: the hash of what it holds, compared on the
 * fields every node of the cluster knows, or why it failed.
 */
export type AreaReading = { ok: true; hash: string } | { ok: false; error: string };

/**
 * A copy's reading also carries `ownHash`, the hash of everything it holds: what dpm last
 * wrote is remembered that way, so that which fields the cluster compares can change -- an older
 * node joins, or gets its first client -- without a copy reading as changed by hand.
 */
export type CopyReading = { ok: true; hash: string; ownHash: string } | { ok: false; error: string };

export interface PlanCopy {
    nodeId: string;
    reading: CopyReading;
    /**
     * The `ownHash` of what dpm last wrote there, or found there already equal to the primary.
     * Null: dpm has written nothing there yet -- the area was just switched on, the primary
     * changed, or the node is new to the cluster. Each of them was confirmed in a preview,
     * so what the copy holds is written over without being reported.
     */
    writtenHash: string | null;
    /** How its link ended the last run; null without one. */
    lastStatus: ConfigLinkStatus | null;
}

export interface AreaPlanInput {
    /**
     * The hash of what the last run found at the primary and spread, compared on the same
     * fields as `primary`; null before the first.
     */
    baselineHash: string | null;
    primary: AreaReading;
    copies: readonly PlanCopy[];
}

/** What happens at one copy. */
export type CopyAction =
    /** It holds what the primary holds: nothing is written, and the link remembers the hash. */
    | { kind: "none"; nodeId: string }
    /** It is behind -- it was not reached, or the primary changed: written, not reported. */
    | { kind: "update"; nodeId: string }
    /** It was changed at the copy itself: written over, and reported with what was there. */
    | { kind: "correct"; nodeId: string }
    /** It could not be read: left as it is, and tried again on the next run. */
    | { kind: "unreachable"; nodeId: string; error: string };

export type AreaPlan =
    /** The primary could not be read: nothing is compared or written, the copies keep what they hold. */
    | { kind: "paused"; error: string }
    | {
          kind: "run";
          /** What every copy is to hold, and the baseline from now on. */
          targetHash: string;
          /** The primary holds something else than the last run spread: a change made there goes out. */
          propagated: boolean;
          copies: CopyAction[];
      };

export function planArea({ baselineHash, primary, copies }: AreaPlanInput): AreaPlan {
    if (!primary.ok) return { kind: "paused", error: primary.error };
    const target = primary.hash;
    return {
        kind: "run",
        targetHash: target,
        propagated: baselineHash !== null && baselineHash !== target,
        copies: copies.map((copy) => actionFor(copy, target)),
    };
}

function actionFor(copy: PlanCopy, target: string): CopyAction {
    const { nodeId, reading, writtenHash, lastStatus } = copy;
    if (!reading.ok) return { kind: "unreachable", nodeId, error: reading.error };
    if (reading.hash === target) return { kind: "none", nodeId };
    // Holds what dpm last wrote, or nothing dpm wrote yet: only behind.
    if (writtenHash === null || reading.ownHash === writtenHash) return { kind: "update", nodeId };
    // The last write failed part way: what differs is dpm's own unfinished work, not a hand's.
    if (lastStatus === "error") return { kind: "update", nodeId };
    return { kind: "correct", nodeId };
}

/** An area as read from one instance: its state in comparable form, or why it could not be read. */
export type AreaState = { ok: true; state: unknown } | { ok: false; error: string };

export interface PreparedArea {
    plan: AreaPlan;
    /** The fields compared: those the primary and every copy that could be read have. */
    shape: Shape | null;
    /** The primary's state on those fields: what every copy is made to hold. */
    target: unknown;
    /** What changed at the primary since the last run, a sentence each; empty unless `plan.propagated`. */
    primaryChanges: string[];
}

/**
 * Everything a run decides for one area of a cluster, from what it read and what it remembers:
 * which fields are compared, the hashes, the plan, and -- for the activity -- what changed at
 * the primary. Pure; `planArea` decides, this prepares its input.
 */
export function prepareArea(
    sync: Pick<ConfigAreaSync<unknown, unknown, unknown>, "diff" | "describe">,
    primary: AreaState,
    baselineState: unknown | null,
    copies: readonly { nodeId: string; area: AreaState; writtenHash: string | null; lastStatus: ConfigLinkStatus | null }[],
): PreparedArea {
    if (!primary.ok) {
        return { plan: planArea({ baselineHash: null, primary, copies: [] }), shape: null, target: null, primaryChanges: [] };
    }
    const readable = copies.flatMap((c) => (c.area.ok ? [c.area.state] : []));
    const shape = commonShape([primary.state, ...readable]);
    const target = project(primary.state, shape);
    const baseline = baselineState === null ? null : project(baselineState, shape);
    const plan = planArea({
        baselineHash: baseline === null ? null : stateHash(baseline),
        primary: { ok: true, hash: stateHash(target) },
        copies: copies.map(({ nodeId, area, writtenHash, lastStatus }) => ({
            nodeId,
            writtenHash,
            lastStatus,
            reading: area.ok ? { ok: true, hash: stateHash(project(area.state, shape)), ownHash: stateHash(area.state) } : { ok: false, error: area.error },
        })),
    });
    const primaryChanges = plan.kind === "run" && plan.propagated && baseline !== null ? sync.diff(target, baseline).map((step) => sync.describe(step)) : [];
    return { plan, shape, target, primaryChanges };
}
