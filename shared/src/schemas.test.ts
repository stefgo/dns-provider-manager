import { describe, expect, it } from "vitest";
import { RecordSitesRequestSchema } from "./schemas.js";

describe("RecordSitesRequestSchema", () => {
    it("takes sites to add and to remove, each once", () => {
        const parsed = RecordSitesRequestSchema.parse({ recordIds: ["r1", "r1", "r2"], add: ["s1", "s1"] });
        expect(parsed).toEqual({ recordIds: ["r1", "r2"], add: ["s1"], remove: [] });
    });

    it("refuses a request that changes nothing", () => {
        expect(RecordSitesRequestSchema.safeParse({ recordIds: ["r1"], add: [], remove: [] }).success).toBe(false);
    });

    it("refuses a site that is added and removed at once", () => {
        expect(RecordSitesRequestSchema.safeParse({ recordIds: ["r1"], add: ["s1"], remove: ["s1"] }).success).toBe(false);
    });

    it("refuses a request without a record", () => {
        expect(RecordSitesRequestSchema.safeParse({ recordIds: [], add: ["s1"] }).success).toBe(false);
    });
});
