import { providerSecretMissing, type Provider, type ProviderInput, type ProviderType } from "@dpm/shared";
import type { FieldErrors, FieldOf } from "../../../lib/entityForm";

/**
 * The editor's fields, as typed -- all types' at once, so switching the type of a new
 * provider keeps what was typed in the fields they share. Only the type's own are sent.
 */
export interface ProviderDraft {
    type: ProviderType;
    name: string;
    autoCorrect: boolean;
    readOnly: boolean;
    /** Only ever a new secret: the server never sends the stored one back. Empty keeps it. */
    secret: string;
    zoneMode: "all" | "selected";
    /** The zones ticked under "Selected zones", by id. */
    zoneIds: string[];
    url: string;
    username: string;
    allowSelfSigned: boolean;
    /** Samba AD's domain controllers, one per line. */
    servers: string;
}

export function emptyProviderDraft(type: ProviderType = "cloudflare"): ProviderDraft {
    return {
        type,
        name: "",
        autoCorrect: false,
        readOnly: false,
        secret: "",
        zoneMode: "all",
        zoneIds: [],
        url: "",
        username: "",
        allowSelfSigned: false,
        servers: "",
    };
}

export function providerDraftFrom(provider: Provider): ProviderDraft {
    const draft = { ...emptyProviderDraft(provider.type), name: provider.name, autoCorrect: provider.autoCorrect, readOnly: provider.readOnly };
    switch (provider.type) {
        case "cloudflare":
            return { ...draft, zoneMode: provider.zoneMode, zoneIds: provider.zoneIds };
        case "adguard":
            return { ...draft, url: provider.url, username: provider.username, allowSelfSigned: provider.allowSelfSigned };
        case "samba-ad":
            return {
                ...draft,
                servers: provider.servers.join("\n"),
                username: provider.username,
                allowSelfSigned: provider.allowSelfSigned,
            };
    }
}

/** The domain controllers of the field: one per line or separated by commas, blanks dropped. */
export const parseServers = (text: string): string[] =>
    text
        .split(/[\n,]/)
        .map((server) => server.trim())
        .filter((server) => server !== "");

/** The draft as the API takes it: the type's own fields, and the secret only when one was typed. */
export function providerInputFrom(draft: ProviderDraft): ProviderInput {
    const common = {
        name: draft.name,
        autoCorrect: draft.autoCorrect,
        readOnly: draft.readOnly,
        secret: draft.secret === "" ? undefined : draft.secret,
    };
    switch (draft.type) {
        case "cloudflare":
            return { type: "cloudflare", ...common, zoneMode: draft.zoneMode, zoneIds: draft.zoneIds };
        case "adguard":
            return { type: "adguard", ...common, url: draft.url, username: draft.username, allowSelfSigned: draft.allowSelfSigned };
        case "samba-ad":
            return {
                type: "samba-ad",
                ...common,
                servers: parseServers(draft.servers),
                username: draft.username,
                allowSelfSigned: draft.allowSelfSigned,
            };
    }
}

/** A new provider needs its secret; a stored one keeps it while the field stays empty. */
export const providerRules =
    (isNew: boolean) =>
    (draft: ProviderDraft): FieldErrors<ProviderDraft> => {
        const missing = isNew ? providerSecretMissing(providerInputFrom(draft)) : null;
        return missing ? { secret: missing } : {};
    };

/** A draft field is named like the request's; a server's issue lands at the list of servers. */
export const providerFieldOf: FieldOf<ProviderDraft> = (path) => {
    const head = path[0];
    switch (head) {
        case "name":
        case "autoCorrect":
        case "readOnly":
        case "secret":
        case "zoneMode":
        case "zoneIds":
        case "url":
        case "username":
        case "allowSelfSigned":
        case "servers":
        case "type":
            return head;
        default:
            return null;
    }
};

/** What the secret field is called for a type. */
export const SECRET_LABEL: Record<ProviderType, string> = {
    cloudflare: "API Token",
    adguard: "Password",
    "samba-ad": "Password",
};
