import { describe, expect, it } from "vitest";
import { activitySearch, paths, recordsFiltered } from "./paths";

describe("paths", () => {
    it("fills a pattern with its parameter", () => {
        expect(paths.record("r1")).toBe("/records/r1");
        expect(paths.provider("p1")).toBe("/providers/p1");
        expect(paths.providerEdit("p1")).toBe("/providers/p1/edit");
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

describe("recordsFiltered", () => {
    it("sets the filters of the record list it is given", () => {
        expect(recordsFiltered({ status: "problems" })).toEqual({ pathname: "/records", search: "?status=problems" });
        expect(recordsFiltered({ site: "parked", status: "in_sync" })).toEqual({
            pathname: "/records",
            search: "?site=parked&status=in_sync",
        });
    });

    it("leaves the query empty without a filter", () => {
        expect(recordsFiltered({})).toEqual({ pathname: "/records", search: "" });
    });
});
