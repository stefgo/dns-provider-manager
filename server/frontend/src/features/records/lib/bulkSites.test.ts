import { describe, expect, it } from "vitest";
import { initialSiteStates, nextSiteState, siteChanges, sitesAfter, sitesChangePreview, sitesOutcome } from "./bulkSites";

const sites = [
    { id: "ext", providerIds: ["cf"] },
    { id: "int", providerIds: ["ag1", "ag2"] },
    { id: "lab", providerIds: ["ag2", "samba"] },
];
const providers = [
    { id: "cf", name: "Cloudflare", writable: true },
    { id: "ag1", name: "AdGuard 1", writable: true },
    { id: "ag2", name: "AdGuard 2", writable: true },
    { id: "samba", name: "Samba", writable: false },
];

describe("initialSiteStates", () => {
    it("says for each site whether every record, some or none has it", () => {
        const records = [{ siteIds: ["ext", "int"] }, { siteIds: ["int"] }];
        expect(initialSiteStates(records, sites)).toEqual({ ext: "some", int: "all", lab: "none" });
    });
});

describe("nextSiteState", () => {
    it("turns a site on and off in turn", () => {
        expect(nextSiteState("all", "all")).toBe("none");
        expect(nextSiteState("none", "all")).toBe("all");
        expect(nextSiteState("none", "none")).toBe("all");
    });

    it("brings a site some records have back to that, after on and off", () => {
        expect(nextSiteState("some", "some")).toBe("all");
        expect(nextSiteState("all", "some")).toBe("none");
        expect(nextSiteState("none", "some")).toBe("some");
    });
});

describe("siteChanges", () => {
    it("asks only for what differs from the start", () => {
        const initial = { ext: "some", int: "all", lab: "none" } as const;
        expect(siteChanges(initial, initial)).toEqual({ add: [], remove: [] });
        expect(siteChanges({ ext: "all", int: "none", lab: "none" }, initial)).toEqual({ add: ["ext"], remove: ["int"] });
        expect(siteChanges({ ext: "none", int: "all", lab: "all" }, initial)).toEqual({ add: ["lab"], remove: ["ext"] });
    });
});

describe("sitesAfter", () => {
    it("adds each site once and takes the removed ones out", () => {
        expect(sitesAfter(["int", "lab"], ["ext", "int"], ["lab"])).toEqual(["int", "ext"]);
    });
});

describe("sitesChangePreview", () => {
    it("counts the records that change, and names the providers they go to and leave", () => {
        const records = [{ siteIds: ["int"] }, { siteIds: ["ext"] }, { siteIds: ["ext", "int"] }];
        expect(sitesChangePreview(records, sites, providers, ["ext"], ["int"])).toEqual({
            changed: 2,
            unchanged: 1,
            writtenTo: ["Cloudflare"],
            removedFrom: ["AdGuard 1", "AdGuard 2"],
            parked: 0,
        });
    });

    it("leaves out a provider another site still writes to, and one dpm only reads", () => {
        const records = [{ siteIds: ["int"] }];
        expect(sitesChangePreview(records, sites, providers, ["lab"], ["int"])).toMatchObject({
            writtenTo: [],
            removedFrom: ["AdGuard 1"],
        });
    });

    it("counts the records left without a site", () => {
        const records = [{ siteIds: ["int"] }, { siteIds: ["int", "ext"] }];
        expect(sitesChangePreview(records, sites, providers, [], ["int"])).toMatchObject({ changed: 2, parked: 1 });
    });
});

describe("sitesOutcome", () => {
    const changed = { name: "app.example.com", type: "A", value: "192.168.1.10" };

    it("counts the records that changed", () => {
        expect(sitesOutcome({ changed: [changed, changed], unchanged: 1, refused: [] })).toEqual({
            variant: "success",
            title: "Sites of 2 records changed",
        });
    });

    it("lists every refusal, and is an error when nothing went through", () => {
        const refused = [{ name: "app.example.com", type: "CNAME", value: "web.example.com", reason: "A CNAME stands alone" }];
        expect(sitesOutcome({ changed: [changed], unchanged: 0, refused })).toEqual({
            variant: "warning",
            title: "Sites of 1 record changed",
            description: "app.example.com CNAME web.example.com: A CNAME stands alone",
        });
        expect(sitesOutcome({ changed: [], unchanged: 0, refused })).toMatchObject({ variant: "error", title: "No record was changed" });
    });
});
