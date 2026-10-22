import { describe, expect, it } from "vitest";
import { breadcrumb, parentCrumb } from "./breadcrumb";
import type { TitleSubject } from "./pageTitle";

const names = (known: Partial<Record<TitleSubject, string>> = {}) => (subject: TitleSubject) => known[subject];

const shell = { pathname: "/" };
const providers = { pathname: "/providers", handle: { nav: { label: "Providers" } } };
const sites = { pathname: "/sites", handle: { nav: { label: "Sites" } } };

describe("breadcrumb", () => {
    it("is empty on a list, which has nothing above it", () => {
        expect(breadcrumb([shell, providers, { pathname: "/providers/" }], names())).toEqual([]);
    });

    it("is empty outside every area", () => {
        expect(breadcrumb([shell, { pathname: "/nowhere", handle: { title: "Not Found" } }], names())).toEqual([]);
    });

    it("leads from the area to the subject, which is the open page and no link", () => {
        const matches = [
            shell,
            providers,
            { pathname: "/providers/a", handle: { subject: "provider" as const } },
            { pathname: "/providers/a/" },
        ];
        expect(breadcrumb(matches, names({ provider: "Cloudflare" }))).toEqual([
            { label: "Providers", to: "/providers" },
            { label: "Cloudflare" },
        ]);
    });

    it("links every route above a form", () => {
        const matches = [
            shell,
            providers,
            { pathname: "/providers/a", handle: { subject: "provider" as const } },
            { pathname: "/providers/a/edit", handle: { title: "Edit" } },
        ];
        expect(breadcrumb(matches, names({ provider: "Cloudflare" }))).toEqual([
            { label: "Providers", to: "/providers" },
            { label: "Cloudflare", to: "/providers/a" },
            { label: "Edit" },
        ]);
    });

    it("calls a subject by its title until it has a name, and leaves it out without either", () => {
        const site = { pathname: "/sites/51", handle: { subject: "site" as const, title: "Site" } };
        expect(breadcrumb([shell, sites, site], names())).toEqual([
            { label: "Sites", to: "/sites" },
            { label: "Site" },
        ]);

        const provider = { pathname: "/providers/a", handle: { subject: "provider" as const } };
        expect(breadcrumb([shell, providers, provider], names())).toEqual([]);
    });
});

describe("parentCrumb", () => {
    it("is the link before the open page", () => {
        const trail = [{ label: "Providers", to: "/providers" }, { label: "Cloudflare", to: "/providers/a" }, { label: "Edit" }];
        expect(parentCrumb(trail)).toEqual({ label: "Cloudflare", to: "/providers/a" });
    });

    it("looks past a link that leads nowhere", () => {
        const trail = [{ label: "Providers", to: "/providers" }, { label: "Cloudflare" }, { label: "Edit" }];
        expect(parentCrumb(trail)).toEqual({ label: "Providers", to: "/providers" });
    });

    it("is nothing without a trail", () => {
        expect(parentCrumb([])).toBeUndefined();
    });
});
