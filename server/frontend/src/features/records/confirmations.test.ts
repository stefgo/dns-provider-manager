import { describe, expect, it } from "vitest";
import { describeDeleteRecord, describeReleaseRecord, describeSaveRemoving } from "./confirmations";

const record = { name: "app.example.com", type: "A" as const, value: "192.168.1.10" };

describe("the texts", () => {
    it("say what a release leaves where", () => {
        expect(describeReleaseRecord(record, ["AdGuard 1", "Cloudflare"]).description).toBe(
            "dpm stops managing it and deletes it here. AdGuard 1 and Cloudflare keep it as it is; it shows up under Unmanaged and can be adopted again.",
        );
        expect(describeReleaseRecord(record, ["AdGuard 1"]).description).toMatch(/AdGuard 1 keeps it as it is/);
        expect(describeReleaseRecord(record, []).description).toBe("No provider holds it; it is deleted here.");
    });

    it("say that a save without a site parks the record", () => {
        expect(describeSaveRemoving("app.example.com", ["AdGuard 1"], true)).toMatchObject({
            title: "Park app.example.com?",
            description: "The record has no site any more: it stays here and is removed from AdGuard 1.",
        });
        expect(describeSaveRemoving("app.example.com", ["AdGuard 1"]).title).toBe("Remove app.example.com from AdGuard 1?");
    });

    it("delete a parked record without naming sites", () => {
        expect(describeDeleteRecord({ ...record, siteIds: [] }, []).description).toBe("The record is deleted.");
        expect(describeDeleteRecord({ ...record, siteIds: ["int"] }, ["AdGuard 1"]).description).toBe(
            "The record leaves the site it belongs to, and is removed from AdGuard 1.",
        );
    });
});
