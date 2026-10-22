import { describe, expect, it } from "vitest";
import { adoptOutcome, adoptableSites, entriesOf, entryKey } from "./adopt";

const sites = [
    { id: "ext", name: "external", providerIds: ["cf1", "cf2"] },
    { id: "cf1only", name: "account 1", providerIds: ["cf1"] },
    { id: "int", name: "internal", providerIds: ["ag"] },
];

describe("adoptableSites", () => {
    it("offers the sites that write to every provider of the entries", () => {
        expect(adoptableSites([{ providerId: "cf1" }], sites).map((s) => s.id)).toEqual(["ext", "cf1only"]);
        expect(adoptableSites([{ providerId: "cf1" }, { providerId: "cf2" }], sites).map((s) => s.id)).toEqual(["ext"]);
        expect(adoptableSites([{ providerId: "cf1" }, { providerId: "ag" }], sites)).toEqual([]);
    });
});

describe("entriesOf", () => {
    it("finds the entries by provider and the provider's id", () => {
        const a = { providerId: "cf1", externalId: "a" };
        const b = { providerId: "cf2", externalId: "a" };
        expect(entryKey(a)).not.toBe(entryKey(b));
        expect(entriesOf([a, b] as never[], new Set([entryKey(b)]))).toEqual([b]);
    });
});

describe("adoptOutcome", () => {
    const adopted = (merged = false) => ({ name: "app.example.com", type: "A" as const, value: "203.0.113.10", merged });

    it("counts what was taken over, and what went to an existing record", () => {
        expect(adoptOutcome({ adopted: [adopted(), adopted(true)], refused: [] })).toEqual({
            variant: "success",
            title: "2 records adopted, 1 of them as another site of an existing record",
        });
    });

    it("lists every refusal, and is an error when nothing went through", () => {
        const refused = [{ name: "bad_name.example.com", type: "A", value: "1.2.3.4", reason: "No underscores" }];
        expect(adoptOutcome({ adopted: [adopted()], refused })).toMatchObject({
            variant: "warning",
            description: "bad_name.example.com A 1.2.3.4: No underscores",
        });
        expect(adoptOutcome({ adopted: [], refused }).variant).toBe("error");
    });
});
