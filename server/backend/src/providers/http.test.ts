import { describe, expect, it } from "vitest";
import { reasonOf } from "./http.js";

describe("reasonOf", () => {
    it("says why a connection failed when the error itself does not", () => {
        expect(reasonOf(Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" }))).toBe("connection refused");
        expect(reasonOf(Object.assign(new Error(""), { code: "EHOSTUNREACH" }))).toBe("EHOSTUNREACH");
        expect(reasonOf(new Error("getaddrinfo ENOTFOUND x"))).toBe("getaddrinfo ENOTFOUND x");
    });
});
