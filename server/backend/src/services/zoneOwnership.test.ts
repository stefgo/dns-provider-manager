import { describe, expect, it } from "vitest";
import { zoneOwnership, type OwnershipProvider } from "./zoneOwnership.js";

const provider = (id: string, createdAt: string, zoneMode: OwnershipProvider["zoneMode"] = "all"): OwnershipProvider => ({
    id,
    createdAt,
    zoneMode,
});
const sees = (providerId: string, zoneId: string, selected = false) => ({ providerId, zoneId, selected });

describe("zoneOwnership", () => {
    it("gives every zone a provider under All zones sees to it", () => {
        const owners = zoneOwnership([provider("a", "1")], [sees("a", "z1"), sees("a", "z2")]);
        expect([...owners]).toEqual([
            ["z1", "a"],
            ["z2", "a"],
        ]);
    });

    it("gives a provider under Selected zones only what is ticked", () => {
        const owners = zoneOwnership([provider("a", "1", "selected")], [sees("a", "z1", true), sees("a", "z2")]);
        expect(owners.get("z1")).toBe("a");
        expect(owners.has("z2")).toBe(false);
    });

    it("keeps a zone two providers see with the one created first", () => {
        const owners = zoneOwnership([provider("late", "2"), provider("early", "1")], [sees("late", "z1"), sees("early", "z1")]);
        expect(owners.get("z1")).toBe("early");
    });

    it("lets a zone ticked explicitly win over one merely seen", () => {
        const providers = [provider("all", "1"), provider("picked", "2", "selected")];
        const owners = zoneOwnership(providers, [sees("all", "z1"), sees("picked", "z1", true), sees("all", "z2")]);
        expect(owners.get("z1")).toBe("picked");
        expect(owners.get("z2")).toBe("all");
    });

    it("ignores the zones of a provider it does not know", () => {
        expect(zoneOwnership([], [sees("gone", "z1")]).size).toBe(0);
    });
});
