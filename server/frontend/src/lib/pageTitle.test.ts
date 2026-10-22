import { describe, expect, it } from "vitest";
import { pageTitle, routeTitle, type TitleSubject } from "./pageTitle";

const names = (known: Partial<Record<TitleSubject, string>>) => (subject: TitleSubject) => known[subject];

describe("pageTitle", () => {
    it("ends in the name of the application", () => {
        expect(pageTitle(["Cloudflare", "Providers"])).toBe("Cloudflare · Providers · DPM");
    });

    it("is the name of the application alone when nothing names the page", () => {
        expect(pageTitle([])).toBe("DPM");
    });

    it("leaves out a part that is missing", () => {
        expect(pageTitle([undefined, "Providers", null, ""])).toBe("Providers · DPM");
    });
});

describe("routeTitle", () => {
    const area = { nav: { label: "Providers" } };

    it("names the area on its list", () => {
        expect(routeTitle([area, undefined], names({}))).toBe("Providers · DPM");
    });

    it("puts the subject in front of its area", () => {
        expect(routeTitle([area, { subject: "provider" }, undefined], names({ provider: "Cloudflare" }))).toBe(
            "Cloudflare · Providers · DPM",
        );
    });

    it("puts a route below the subject in front of it", () => {
        expect(routeTitle([area, { subject: "provider" }, { title: "Edit" }], names({ provider: "Cloudflare" }))).toBe(
            "Edit · Cloudflare · Providers · DPM",
        );
    });

    it("calls a route by its title until its subject has a name", () => {
        const handles = [{ nav: { label: "Sites" } }, { subject: "site" as const, title: "Site" }];
        expect(routeTitle(handles, names({ site: "internal" }))).toBe("internal · Sites · DPM");
        expect(routeTitle(handles, names({}))).toBe("Site · Sites · DPM");
    });

    it("leaves out a subject that has neither a name nor a title", () => {
        expect(routeTitle([area, { subject: "provider" }], names({}))).toBe("Providers · DPM");
    });

    it("is the name of the application outside every area", () => {
        expect(routeTitle([undefined], names({}))).toBe("DPM");
    });
});
