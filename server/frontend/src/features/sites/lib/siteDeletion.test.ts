import { describe, expect, it } from "vitest";
import { siteDeletion } from "./siteDeletion";
import { describeDeleteSite, describeSiteInUse } from "../confirmations";

const records = [
    { name: "nas.example.com", siteIds: ["int"] },
    { name: "app.example.com", siteIds: ["int"] },
    { name: "www.example.com", siteIds: ["int", "ext"] },
    { name: "web.example.com", siteIds: ["ext"] },
];

describe("siteDeletion", () => {
    it("names the records that belong to the site alone and counts those that keep another", () => {
        expect(siteDeletion("int", records)).toEqual({ alone: ["app.example.com", "nas.example.com"], shared: 1 });
        expect(siteDeletion("ext", records)).toEqual({ alone: ["web.example.com"], shared: 1 });
        expect(siteDeletion("lab", records)).toEqual({ alone: [], shared: 0 });
    });

    it("names a name once, even with several records under it", () => {
        const twice = [
            { name: "app.example.com", siteIds: ["int"] },
            { name: "app.example.com", siteIds: ["int"] },
        ];
        expect(siteDeletion("int", twice).alone).toEqual(["app.example.com"]);
    });
});

describe("the texts", () => {
    it("say what a deletion keeps", () => {
        expect(describeDeleteSite({ name: "lab" }, 0).description).toBe("No record belongs to it. Its providers stay as they are.");
        expect(describeDeleteSite({ name: "int" }, 2).description).toMatch(/^Its 2 records keep their other sites/);
    });

    it("name at most three records that block it", () => {
        expect(describeSiteInUse({ name: "int" }, ["a", "b", "c", "d"]).description).toBe(
            "4 records belong to it alone (a, b, c and 1 more). Give them another site or delete them first.",
        );
        expect(describeSiteInUse({ name: "int" }, ["a"]).description).toBe(
            "1 record belongs to it alone (a). Give it another site or delete it first.",
        );
    });
});
