import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS } from "@dpm/shared";
import { DEFAULT_CHOICE, EVENT_LEVEL_GROUPS, choiceOf, levelChoices, withChoice } from "./eventLevels";

describe("EVENT_LEVEL_GROUPS", () => {
    it("holds every kind once", () => {
        const kinds = EVENT_LEVEL_GROUPS.flatMap((group) => group.kinds);
        expect([...kinds].sort()).toEqual([...ACTIVITY_KINDS].sort());
    });

    it("has a heading for every kind this build knows", () => {
        expect(EVENT_LEVEL_GROUPS.map((group) => group.label)).not.toContain("Other");
    });
});

describe("levelChoices", () => {
    it("names the level a kind has when left alone", () => {
        expect(levelChoices("scheduler.failed")[0]).toEqual({
            value: DEFAULT_CHOICE,
            label: "Default (error)",
        });
    });

    it("offers none for a kind that can be switched off", () => {
        expect(levelChoices("scheduler.failed").map((c) => c.value)).toEqual([
            DEFAULT_CHOICE, "trace", "info", "warning", "error", "none",
        ]);
    });
});

describe("choiceOf", () => {
    it("is the default for a kind the setting does not name", () => {
        expect(choiceOf("scheduler.failed=error", "record.created")).toBe(DEFAULT_CHOICE);
    });

    it("is what the setting says", () => {
        expect(choiceOf("scheduler.failed=error, record.deleted=none", "record.deleted")).toBe("none");
    });
});

describe("withChoice", () => {
    it("adds an entry", () => {
        expect(withChoice("", "scheduler.failed", "error")).toBe("scheduler.failed=error");
    });

    it("replaces an entry", () => {
        expect(withChoice("scheduler.failed=error, record.created=trace", "scheduler.failed", "info")).toBe(
            "record.created=trace, scheduler.failed=info",
        );
    });

    it("removes the entry of a kind set back to its default", () => {
        expect(withChoice("scheduler.failed=error, record.created=trace", "scheduler.failed", DEFAULT_CHOICE)).toBe(
            "record.created=trace",
        );
    });

    // Written into config.yaml by hand, for a kind only a newer version records.
    it("keeps an entry this page has no row for", () => {
        expect(withChoice("record.renamed=none", "scheduler.failed", "error")).toBe(
            "record.renamed=none, scheduler.failed=error",
        );
    });
});
