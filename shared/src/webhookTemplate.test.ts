import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "./types.js";
import {
    DEFAULT_WEBHOOK_TEMPLATE,
    buildWebhookContext,
    placeholderError,
    renderTemplate,
    sampleWebhookRecord,
    webhookAccepts,
    webhookTemplateError,
    type WebhookContext,
} from "./webhookTemplate.js";

const record = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "server",
    kind: "scheduler.failed",
    level: "error",
    seen: false,
    subject: null,
    data: { scheduler: "notification-cleanup", error: "database is locked" },
    ...over,
});

const context = (over: Partial<ActivityRecord> = {}): WebhookContext => buildWebhookContext(record(over), "Chat");

describe("the roots of a webhook template", () => {
    // The grammar is tested where it lives, in @stefgo/js-template-engine. What is decided
    // here is what a path may start with.
    it("reads the event and the webhook", () => {
        expect(webhookTemplateError('{"text": "{{event.kind}} {{webhook.name}}"}')).toBeNull();
        expect(placeholderError(["https://example.org/{{event.id}}", "Bearer {{webhook.name}}"])).toBeNull();
    });

    it("has nothing to say about the template a new webhook starts with", () => {
        expect(webhookTemplateError(DEFAULT_WEBHOOK_TEMPLATE)).toBeNull();
    });

    it("refuses a path that starts with anything else", () => {
        expect(webhookTemplateError('{"text": "{{host.name}}"}')).toBe(
            'text: "{{host.name}}": a path starts with event, webhook',
        );
        expect(placeholderError("{{host.name}}")).toBe('"{{host.name}}": a path starts with event, webhook');
    });
});

describe("buildWebhookContext", () => {
    it("carries the event with the sentence the dashboard shows", () => {
        expect(context().event).toMatchObject({
            id: "e1",
            kind: "scheduler.failed",
            level: "error",
            correlationId: null,
            message: "Activity cleanup failed: database is locked",
            detail: "database is locked",
        });
    });

    it("carries the webhook's name", () => {
        expect(context().webhook).toEqual({ name: "Chat" });
    });
});

describe("webhookAccepts", () => {
    it("wants the level at least", () => {
        const filter = { minLevel: "warning" as const, kinds: [] };
        expect(webhookAccepts(filter, { kind: "x", level: "info" })).toBe(false);
        expect(webhookAccepts(filter, { kind: "x", level: "warning" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "x", level: "error" })).toBe(true);
    });

    it("wants one of the kinds, or any kind where none is named", () => {
        const filter = { minLevel: "trace" as const, kinds: ["record.*", "scheduler.failed"] };
        expect(webhookAccepts(filter, { kind: "record.created", level: "info" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "scheduler.failed", level: "info" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "provider.unreachable", level: "info" })).toBe(false);
        expect(webhookAccepts({ minLevel: "trace", kinds: [] }, { kind: "anything", level: "info" })).toBe(true);
    });
});

describe("sampleWebhookRecord", () => {
    it("is the first sample unless the kinds say otherwise", () => {
        expect(sampleWebhookRecord().kind).toBe("scheduler.failed");
        expect(sampleWebhookRecord(["record.*"]).kind).toBe("scheduler.failed");
    });

    it("is the first sample one of the kinds matches", () => {
        expect(sampleWebhookRecord(["scheduler.*"]).kind).toBe("scheduler.failed");
    });

    it("renders with the default template", () => {
        const body = renderTemplate(JSON.parse(DEFAULT_WEBHOOK_TEMPLATE), buildWebhookContext(sampleWebhookRecord(), "Chat"));
        expect(body).toMatchObject({
            text: "[error] Activity cleanup failed: database is locked",
            kind: "scheduler.failed",
            data: { scheduler: "notification-cleanup" },
        });
    });
});
