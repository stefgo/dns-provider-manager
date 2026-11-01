import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SECTIONS } from "../sections";
import { describeSettingsSave } from "./saveMessage";

const providers = SECTIONS.find((s) => s.id === "providers")!;
const activity = SECTIONS.find((s) => s.id === "activity")!;

describe("describeSettingsSave", () => {
    it("names the provider settings that changed, with what they were", () => {
        expect(describeSettingsSave(providers, DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, cluster_sync_interval_minutes: "1" })).toEqual({
            title: "Provider settings saved",
            description: "The AdGuard Home clusters are kept alike every minute (was every 5 minutes).",
        });
        expect(
            describeSettingsSave(providers, DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, provider_read_interval_minutes: "0", cluster_sync_interval_minutes: "10" })
                .description,
        ).toBe("The providers are read only on request (was every 5 minutes). The AdGuard Home clusters are kept alike every 10 minutes (was every 5 minutes).");
    });

    it("leaves out what did not change, and words the activity history in its own terms", () => {
        const after = { ...DEFAULT_SETTINGS, notification_retention_days: "30", activity_level_overrides: "scheduler.failed=warning,record.drift=none" };
        expect(describeSettingsSave(activity, DEFAULT_SETTINGS, after)).toEqual({
            title: "Activity history settings saved",
            description: "Events are kept for 30 days (was 90 days). The level of 2 event kinds changed; it applies to events from now on.",
        });
        expect(describeSettingsSave(activity, DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, notification_cleanup_interval_hours: "0" }).description).toBe(
            "The cleanup runs only on request (was every 24 hours).",
        );
    });

    it("says only whose settings were saved when nothing it words changed", () => {
        expect(describeSettingsSave(providers, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual({ title: "Provider settings saved" });
    });
});
