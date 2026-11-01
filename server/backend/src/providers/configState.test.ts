import { describe, expect, it } from "vitest";
import { canonicalJson, commonShape, project, stateHash } from "./configState.js";

describe("canonicalJson", () => {
    it("writes the keys of every object in one order, nested ones included", () => {
        expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}');
    });

    it("keeps the order of an array and leaves out an undefined value", () => {
        expect(canonicalJson({ list: [3, 1, 2], gone: undefined })).toBe('{"list":[3,1,2]}');
    });
});

describe("stateHash", () => {
    it("is the same for equal states built in another order, and differs for another value", () => {
        expect(stateHash({ a: 1, b: [1, 2] })).toBe(stateHash({ b: [1, 2], a: 1 }));
        expect(stateHash({ a: 1, b: [1, 2] })).not.toBe(stateHash({ a: 1, b: [2, 1] }));
        expect(stateHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("commonShape and project", () => {
    it("drops a field one instance does not know, nested ones included", () => {
        const newer = { safesearch: { enabled: true, ecosia: true, google: true }, cache_enabled: true, cache_size: 1 };
        const older = { safesearch: { enabled: true, google: false }, cache_size: 2 };
        const shape = commonShape([newer, older]);
        expect(project(newer, shape)).toEqual({ safesearch: { enabled: true, google: true }, cache_size: 1 });
        expect(project(older, shape)).toEqual(older);
    });

    it("takes the fields of list elements from every element, and an empty list says nothing", () => {
        const newer = { clients: [{ name: "TV", upstreams_cache_size: 0 }] };
        const older = { clients: [{ name: "PC" }] };
        const none = { clients: [] };
        expect(project(newer, commonShape([newer, older, none]))).toEqual({ clients: [{ name: "TV" }] });
        expect(project(newer, commonShape([newer, none]))).toEqual(newer);
    });

    it("leaves a day of a schedule that is null in one and set in another", () => {
        const a = { schedule: { mon: null } };
        const b = { schedule: { mon: { start: 0, end: 60 } } };
        const shape = commonShape([a, b]);
        expect(project(b, shape)).toEqual(b);
        expect(project(a, shape)).toEqual(a);
    });
});
