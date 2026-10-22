import { describe, expect, it } from "vitest";
import { activitySearch, paths } from "./paths";

describe("paths", () => {
    it("fills a pattern with its parameter", () => {
        expect(paths.record("r1")).toBe("/records/r1");
        expect(paths.provider("p1")).toBe("/providers/p1");
        expect(paths.site("s1")).toBe("/sites/s1");
        expect(paths.webhook("w1")).toBe("/webhooks/w1");
    });

    it("encodes what a path segment cannot carry", () => {
        expect(paths.webhook("a/b")).toBe("/webhooks/a%2Fb");
    });
});

describe("activitySearch", () => {
    it("names the search in the query of the activity list", () => {
        expect(activitySearch("app.example.com")).toEqual({ pathname: "/activity", search: "?search=app.example.com" });
    });
});
