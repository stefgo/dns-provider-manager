import { describe, expect, it } from "vitest";
import { describeSiteSync } from "./siteSync";

const providers = [
    { id: "a", name: "AdGuard 1" },
    { id: "b", name: "AdGuard 2" },
];

describe("describeSiteSync", () => {
    it("asks nothing when no record moves", () => {
        expect(describeSiteSync("internal", [{ providerId: "a", create: 0, delete: 0 }], providers)).toBeNull();
    });

    it("names who gets and who loses the site's records", () => {
        const question = describeSiteSync(
            "internal",
            [
                { providerId: "b", create: 3, delete: 0 },
                { providerId: "a", create: 0, delete: 1 },
            ],
            providers,
        );
        expect(question?.description).toMatch(/^AdGuard 2 gets 3 records, AdGuard 1 loses 1 record\./);
        expect(question?.variant).toBe("danger");
    });
});
