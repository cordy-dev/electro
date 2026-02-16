import { describe, expect, it } from "vitest";
import { createEvent } from "./helpers";

describe("createEvent", () => {
    it("creates event with explicit void type", () => {
        const evt = createEvent("shutdown");
        expect(evt.id).toBe("shutdown");
        expect(evt.defaults).toBeUndefined();
    });

    it("creates event with defaults and inferred type", () => {
        const evt = createEvent("ready", { version: "0.0.0", startedAt: 0 });
        expect(evt.id).toBe("ready");
        expect(evt.defaults).toEqual({ version: "0.0.0", startedAt: 0 });
    });

    it("throws on empty id", () => {
        expect(() => createEvent("")).toThrow("id is required");
    });

    it("throws on whitespace-only id", () => {
        expect(() => createEvent("   ")).toThrow("id is required");
    });

    it("is reusable across multiple features", () => {
        const evt = createEvent("ready", { version: "0" });
        // Same instance can be referenced in multiple createFeature calls
        expect(evt.id).toBe("ready");
        expect(evt.defaults).toEqual({ version: "0" });
    });
});
