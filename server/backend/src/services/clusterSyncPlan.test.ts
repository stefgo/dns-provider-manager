import { describe, expect, it } from "vitest";
import { planArea, prepareArea, type AreaReading, type CopyReading, type PlanCopy } from "./clusterSyncPlan.js";

const read = (hash: string, ownHash = hash): AreaReading & CopyReading => ({ ok: true, hash, ownHash });
const down = (error = "b could not be reached: connection refused"): AreaReading & CopyReading => ({ ok: false, error });

const copy = (nodeId: string, reading: CopyReading, over: Partial<PlanCopy> = {}): PlanCopy => ({
    nodeId,
    reading,
    writtenHash: "h1",
    lastStatus: "in_sync",
    ...over,
});

describe("planArea", () => {
    it("pauses while the primary cannot be read, and leaves the copies alone", () => {
        const plan = planArea({ baselineHash: "h1", primary: down("a could not be reached"), copies: [copy("b", read("h9"))] });
        expect(plan).toEqual({ kind: "paused", error: "a could not be reached" });
    });

    it("does nothing while the primary and the copies hold what was spread last", () => {
        const plan = planArea({ baselineHash: "h1", primary: read("h1"), copies: [copy("b", read("h1")), copy("c", read("h1"))] });
        expect(plan).toEqual({
            kind: "run",
            targetHash: "h1",
            propagated: false,
            copies: [
                { kind: "none", nodeId: "b" },
                { kind: "none", nodeId: "c" },
            ],
        });
    });

    it("spreads a change made at the primary to every copy, without reporting the copies", () => {
        const plan = planArea({ baselineHash: "h1", primary: read("h2"), copies: [copy("b", read("h1")), copy("c", read("h1"))] });
        expect(plan).toMatchObject({ kind: "run", targetHash: "h2", propagated: true });
        expect(plan.kind === "run" && plan.copies.map((c) => c.kind)).toEqual(["update", "update"]);
    });

    it("brings a copy up that was not reached when a change went out", () => {
        // c was down when h2 went out: it still holds h1, which dpm wrote there.
        const plan = planArea({
            baselineHash: "h2",
            primary: read("h2"),
            copies: [copy("b", read("h2"), { writtenHash: "h2" }), copy("c", read("h1"), { writtenHash: "h1", lastStatus: "pending" })],
        });
        expect(plan).toMatchObject({ propagated: false });
        expect(plan.kind === "run" && plan.copies).toEqual([
            { kind: "none", nodeId: "b" },
            { kind: "update", nodeId: "c" },
        ]);
    });

    it("writes over a change made at a copy, and says so", () => {
        const plan = planArea({ baselineHash: "h1", primary: read("h1"), copies: [copy("b", read("hand"))] });
        expect(plan.kind === "run" && plan.copies).toEqual([{ kind: "correct", nodeId: "b" }]);
    });

    it("reports a change at a copy even while the primary changed as well", () => {
        const plan = planArea({ baselineHash: "h1", primary: read("h2"), copies: [copy("b", read("hand"))] });
        expect(plan).toMatchObject({ propagated: true });
        expect(plan.kind === "run" && plan.copies).toEqual([{ kind: "correct", nodeId: "b" }]);
    });

    it("takes what differs after a failed write for dpm's own unfinished work", () => {
        // Half of the clients were written before the next one failed.
        const plan = planArea({ baselineHash: "h2", primary: read("h2"), copies: [copy("b", read("half"), { lastStatus: "error" })] });
        expect(plan.kind === "run" && plan.copies).toEqual([{ kind: "update", nodeId: "b" }]);
    });

    it("writes over a copy dpm has written nothing to yet without reporting it", () => {
        // Switched on, a new primary chosen, or the node is new to the cluster: confirmed in the preview.
        const plan = planArea({ baselineHash: null, primary: read("h1"), copies: [copy("b", read("other"), { writtenHash: null, lastStatus: null })] });
        expect(plan).toMatchObject({ kind: "run", targetHash: "h1", propagated: false });
        expect(plan.kind === "run" && plan.copies).toEqual([{ kind: "update", nodeId: "b" }]);
    });

    it("makes the old primary a copy once another one is chosen", () => {
        // a was the primary and holds h1; b is chosen and holds h2. Every link starts without a hash.
        const plan = planArea({ baselineHash: "h2", primary: read("h2"), copies: [copy("a", read("h1"), { writtenHash: null, lastStatus: null })] });
        expect(plan).toMatchObject({ propagated: false });
        expect(plan.kind === "run" && plan.copies).toEqual([{ kind: "update", nodeId: "a" }]);
    });

    it("leaves a copy that cannot be read for the next run, and goes on with the others", () => {
        const plan = planArea({ baselineHash: "h1", primary: read("h2"), copies: [copy("b", down()), copy("c", read("h1"))] });
        expect(plan.kind === "run" && plan.copies).toEqual([
            { kind: "unreachable", nodeId: "b", error: "b could not be reached: connection refused" },
            { kind: "update", nodeId: "c" },
        ]);
    });

    it("tells a copy that is behind by everything it holds, not by the fields compared", () => {
        // An older node joined: the cluster compares fewer fields now, so the compared hash of
        // b changed, while what b holds is still what dpm wrote there.
        const plan = planArea({ baselineHash: "h2", primary: read("h2"), copies: [copy("b", read("h1-fewer", "own-b"), { writtenHash: "own-b" })] });
        expect(plan.kind === "run" && plan.copies).toEqual([{ kind: "update", nodeId: "b" }]);
    });
});

describe("prepareArea", () => {
    // An area of flat fields, as the service hands one in.
    const sync = {
        diff: (target: unknown, current: unknown) => {
            const t = target as Record<string, unknown>;
            const c = current as Record<string, unknown>;
            return Object.keys(t).filter((k) => t[k] !== c[k]);
        },
        describe: (step: unknown) => `${step as string} changed`,
    };
    const ok = (state: unknown) => ({ ok: true as const, state });

    it("compares on the fields every readable instance has, and names what changed at the primary", () => {
        const primary = ok({ cache: 2, ecosia: true });
        const older = { nodeId: "b", area: ok({ cache: 1 }), writtenHash: null, lastStatus: null };
        const prepared = prepareArea(sync, primary, { cache: 1, ecosia: false }, [older]);
        expect(prepared.target).toEqual({ cache: 2 });
        expect(prepared.plan).toMatchObject({ kind: "run", propagated: true, copies: [{ kind: "update", nodeId: "b" }] });
        expect(prepared.primaryChanges).toEqual(["cache changed"]);
    });

    it("compares a field an unreadable copy may not know all the same", () => {
        // Ecosia changed at the primary, but the older copy cannot be read and does not count.
        const down = { nodeId: "b", area: { ok: false as const, error: "down" }, writtenHash: "x", lastStatus: "in_sync" as const };
        const prepared = prepareArea(sync, ok({ cache: 1, ecosia: true }), { cache: 1, ecosia: false }, [down]);
        expect(prepared.plan).toMatchObject({ propagated: true });
        expect(prepared.primaryChanges).toEqual(["ecosia changed"]);
    });

    it("pauses when the primary's area could not be read", () => {
        expect(prepareArea(sync, { ok: false, error: "refused" }, null, []).plan).toEqual({ kind: "paused", error: "refused" });
    });
});
