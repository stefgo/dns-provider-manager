import { describe, expect, it } from "vitest";
import { queueFor } from "./providerQueue.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("queueFor", () => {
    it("runs the work of one provider one after another, and of two side by side", async () => {
        const log: string[] = [];
        const job = (name: string) => async () => {
            log.push(`${name} start`);
            await tick();
            log.push(`${name} end`);
            return name;
        };
        const results = await Promise.all([queueFor("a", job("a1")), queueFor("a", job("a2")), queueFor("b", job("b1"))]);
        expect(results).toEqual(["a1", "a2", "b1"]);
        expect(log.indexOf("a1 end")).toBeLessThan(log.indexOf("a2 start"));
        expect(log.indexOf("b1 start")).toBeLessThan(log.indexOf("a1 end"));
    });

    it("goes on after a failure, and passes the failure to its caller", async () => {
        const failed = queueFor("c", async () => {
            throw new Error("down");
        });
        const next = queueFor("c", async () => "next");
        await expect(failed).rejects.toThrow("down");
        await expect(next).resolves.toBe("next");
    });
});
