import { describe, expect, it } from "vitest";
import { ProviderInputSchema, type Provider } from "@dpm/shared";
import { checkDraft } from "../../../lib/entityForm";
import {
    emptyProviderDraft,
    parseServers,
    providerDraftFrom,
    providerFieldOf,
    providerInputFrom,
    providerRules,
    type ProviderDraft,
} from "./providerForm";

const check = (draft: ProviderDraft, isNew = true) =>
    checkDraft({ schema: ProviderInputSchema, toInput: providerInputFrom, fieldOf: providerFieldOf, rules: providerRules(isNew) }, draft);

const stored: Provider = {
    type: "samba-ad",
    id: "p1",
    name: "Samba",
    autoCorrect: false,
    readOnly: false,
    writable: false,
    hasSecret: true,
    siteIds: [],
    createdAt: "2026-10-22T10:00:00Z",
    updatedAt: null,
    lastSeenAt: null,
    lastError: null,
    zones: [],
    readable: false,
    servers: ["dc1.ad.example.com", "dc2.ad.example.com:636"],
    username: "dpm@ad.example.com",
    allowSelfSigned: true,
};

describe("providerInputFrom", () => {
    it("sends only the fields of the draft's type", () => {
        const draft = { ...emptyProviderDraft("cloudflare"), name: "CF", secret: "token", url: "http://left.over" };
        expect(providerInputFrom(draft)).toEqual({
            type: "cloudflare",
            name: "CF",
            autoCorrect: false,
            readOnly: false,
            secret: "token",
            zoneMode: "all",
            zoneIds: [],
        });
    });

    it("leaves the secret out while the field is empty, so the stored one stays", () => {
        expect(providerInputFrom(providerDraftFrom(stored)).secret).toBeUndefined();
    });

    it("is what providerDraftFrom read", () => {
        expect(providerInputFrom(providerDraftFrom(stored))).toEqual({
            type: "samba-ad",
            name: "Samba",
            autoCorrect: false,
            readOnly: false,
            secret: undefined,
            servers: ["dc1.ad.example.com", "dc2.ad.example.com:636"],
            username: "dpm@ad.example.com",
            allowSelfSigned: true,
        });
    });
});

describe("parseServers", () => {
    it("takes one per line or comma separated, without blanks", () => {
        expect(parseServers(" dc1 \n\n dc2:636, dc3 ")).toEqual(["dc1", "dc2:636", "dc3"]);
    });
});

describe("the provider editor's check", () => {
    it("asks a new provider for its secret, and not a stored one", () => {
        const draft = { ...emptyProviderDraft("cloudflare"), name: "CF" };
        expect(check(draft).errors.secret).toBe("Enter the API token");
        expect(check(draft, false).isValid).toBe(true);
    });

    it("says at the field what the server would refuse", () => {
        const draft = { ...emptyProviderDraft("adguard"), name: "AG", secret: "pw", url: "ftp://x", username: "" };
        const { errors } = check(draft);
        expect(errors.url).toBe("Must be an http:// or https:// URL");
        expect(errors.username).toBe("Enter the user name");
        expect(check({ ...emptyProviderDraft("samba-ad"), name: "S", secret: "pw", username: "u", servers: "ldaps://dc1" }).errors.servers).toMatch(
            /not a host or host:port/,
        );
    });
});
