import { describe, expect, it } from "vitest";
import { fieldChanges, nameList } from "./changes.js";

describe("fieldChanges", () => {
    it("lists the fields whose text differs, in the order of the new description", () => {
        const before = { name: "app.example.com", value: "192.168.1.10", ttl: "default" };
        const after = { name: "app.example.com", ttl: "300 s", value: "192.168.1.11" };
        expect(fieldChanges(before, after)).toEqual([
            { field: "ttl", from: "default", to: "300 s" },
            { field: "value", from: "192.168.1.10", to: "192.168.1.11" },
        ]);
    });

    it("is empty when nothing changed, and names a field the old description lacked", () => {
        expect(fieldChanges({ a: "1" }, { a: "1" })).toEqual([]);
        expect(fieldChanges({}, { a: "1" })).toEqual([{ field: "a", from: "–", to: "1" }]);
    });
});

describe("nameList", () => {
    it("does not count another order as a change", () => {
        expect(nameList(["internal", "external"])).toBe(nameList(["external", "internal"]));
        expect(nameList([])).toBe("–");
    });
});
