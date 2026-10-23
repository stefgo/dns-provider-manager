import { describe, expect, it } from "vitest";
import { siteDeletion } from "./siteDeletion";
import { describeDeleteSite } from "../confirmations";

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
        expect(describeDeleteSite({ name: "lab" }, { alone: [], shared: 0 }).description).toBe("No record belongs to it. Its providers stay as they are.");
        expect(describeDeleteSite({ name: "int" }, { alone: [], shared: 2 }).description).toMatch(/^Its 2 records keep their other sites/);
    });

    it("name at most three records it parks", () => {
        expect(describeDeleteSite({ name: "int" }, { alone: ["a", "b", "c", "d"], shared: 1 }).description).toBe(
            "4 records belong to it alone (a, b, c and 1 more) and are parked: kept here without a site, and removed from its providers. The other record keeps its other sites and leaves this one. Its providers stay as they are.",
        );
        expect(describeDeleteSite({ name: "int" }, { alone: ["a"], shared: 0 }).description).toBe(
            "1 record belongs to it alone (a) and is parked: kept here without a site, and removed from its providers. Its providers stay as they are.",
        );
    });
});
