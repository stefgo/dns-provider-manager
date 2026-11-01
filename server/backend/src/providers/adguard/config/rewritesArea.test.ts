import { describe, expect, it } from "vitest";
import { commonShape, project } from "../../configState.js";
import { answeringApi, recorded } from "../../../testing/adguardRecording.js";
import { rewritesArea, type RewritesState } from "./rewritesArea.js";

/**
 * What the two versions answered for the same rewrites, added alike (tried against the images):
 * a repeat, a CNAME added switched off, an "answer A from upstream" and an AAAA. v0.107.33 has
 * neither `enabled` nor `/control/rewrite/settings`, and adds the one switched off as on.
 */
const NEW_LIST = [
    { domain: "a.lan", answer: "10.0.0.1", enabled: true },
    { domain: "a.lan", answer: "10.0.0.1", enabled: true },
    { domain: "b.lan", answer: "a.lan", enabled: false },
    { domain: "*.c.lan", answer: "A", enabled: true },
    { domain: "d.lan", answer: "fd00::1", enabled: true },
];
const OLD_LIST = NEW_LIST.map(({ domain, answer }) => ({ domain, answer }));

const answersOf = (version: "v0.107.79" | "v0.107.33", list: unknown[], settings?: unknown) => ({
    "/control/status": recorded(version)["/control/status"],
    "/control/rewrite/list": list,
    ...(settings === undefined ? {} : { "/control/rewrite/settings": settings }),
});

const state = (rewrites: RewritesState["rewrites"], enabled?: boolean): RewritesState => (enabled === undefined ? { rewrites } : { enabled, rewrites });

describe("rewritesArea", () => {
    it("reads every rewrite, repeats and those dpm does not manage included, sorted", async () => {
        const raw = await rewritesArea.read(answeringApi(answersOf("v0.107.79", NEW_LIST, { enabled: true })).api);
        expect(rewritesArea.normalise(raw)).toEqual({
            enabled: true,
            rewrites: [
                { domain: "*.c.lan", answer: "A", enabled: true },
                { domain: "a.lan", answer: "10.0.0.1", enabled: true },
                { domain: "a.lan", answer: "10.0.0.1", enabled: true },
                { domain: "b.lan", answer: "a.lan", enabled: false },
                { domain: "d.lan", answer: "fd00::1", enabled: true },
            ],
        });
    });

    it("asks an older version for no switch it does not have", async () => {
        // No answer for /control/rewrite/settings: asking would be a 404.
        const raw = await rewritesArea.read(answeringApi(answersOf("v0.107.33", OLD_LIST)).api);
        const read = rewritesArea.normalise(raw);
        expect(read.enabled).toBeUndefined();
        expect(read.rewrites[0]).toEqual({ domain: "*.c.lan", answer: "A" });
    });

    it("adds what is missing, removes what is extra and switches what differs", () => {
        const target = state([
            { domain: "a.lan", answer: "10.0.0.1", enabled: true },
            { domain: "b.lan", answer: "a.lan", enabled: false },
        ], true);
        expect(rewritesArea.diff(target, target)).toEqual([]);
        const current = state([
            { domain: "b.lan", answer: "a.lan", enabled: true },
            { domain: "old.lan", answer: "10.0.0.9", enabled: true },
        ], false);
        expect(rewritesArea.diff(target, current).map((s) => rewritesArea.describe(s))).toEqual([
            "Rewrite old.lan → 10.0.0.9 removed",
            "Rewrite b.lan → a.lan switched off",
            "Rewrite a.lan → 10.0.0.1 added",
            "All rewrites switched on",
        ]);
    });

    it("brings repeats to the primary's count by removing them all and adding what it holds", () => {
        const one = { domain: "a.lan", answer: "10.0.0.1", enabled: true };
        expect(rewritesArea.diff(state([one]), state([one, one])).map((s) => rewritesArea.describe(s))).toEqual([
            "Rewrite a.lan → 10.0.0.1 removed",
            "Rewrite a.lan → 10.0.0.1 added",
        ]);
        expect(rewritesArea.diff(state([one, one]), state([one])).map((s) => s.kind)).toEqual(["delete", "add", "add"]);
    });

    it("compares a cluster with an older node without what the older one does not know", () => {
        const primary = rewritesArea.normalise({ list: NEW_LIST, settings: { enabled: false } });
        const node = rewritesArea.normalise({ list: OLD_LIST });
        const shape = commonShape([primary, node]);
        expect(rewritesArea.diff(project(primary, shape), project(node, shape))).toEqual([]);
    });

    it("writes each step through the endpoint for it", async () => {
        const { api, writes } = answeringApi({});
        await rewritesArea.apply(api, [
            { kind: "delete", domain: "old.lan", answer: "10.0.0.9" },
            { kind: "update", rewrite: { domain: "b.lan", answer: "a.lan", enabled: false } },
            { kind: "add", rewrite: { domain: "a.lan", answer: "10.0.0.1", enabled: true } },
            { kind: "switch", enabled: true },
        ]);
        expect(writes.map((w) => [w.method, w.path, w.body])).toEqual([
            ["POST", "/control/rewrite/delete", { domain: "old.lan", answer: "10.0.0.9" }],
            ["PUT", "/control/rewrite/update", { target: { domain: "b.lan", answer: "a.lan" }, update: { domain: "b.lan", answer: "a.lan", enabled: false } }],
            ["POST", "/control/rewrite/add", { domain: "a.lan", answer: "10.0.0.1", enabled: true }],
            ["PUT", "/control/rewrite/settings/update", { enabled: true }],
        ]);
    });
});
