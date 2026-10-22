import { describe, expect, it } from "vitest";
import { SiteInputSchema } from "@dpm/shared";
import { checkDraft } from "../../../lib/entityForm";
import { EMPTY_SITE_DRAFT, siteDraftFrom, siteInputFrom } from "./siteForm";

describe("the site editor's check", () => {
    it("needs a name, and nothing else", () => {
        const check = (name: string) => checkDraft({ schema: SiteInputSchema, toInput: siteInputFrom }, { ...EMPTY_SITE_DRAFT, name });
        expect(check("").errors.name).toBe("Enter a name");
        expect(check("internal").isValid).toBe(true);
    });

    it("sends what siteDraftFrom read", () => {
        const site = {
            id: "s1",
            name: "internal",
            description: "At home",
            providerIds: ["p1"],
            recordCount: 3,
            createdAt: "2026-10-22T10:00:00Z",
            updatedAt: null,
        };
        expect(siteInputFrom(siteDraftFrom(site))).toEqual({ name: "internal", description: "At home", providerIds: ["p1"] });
    });
});
