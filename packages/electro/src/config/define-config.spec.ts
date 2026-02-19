import { describe, expect, it } from "vitest";
import { defineConfig } from "./define-config";
import { defineRuntime } from "./define-runtime";
import { defineView } from "./define-view";

describe("defineConfig()", () => {
    const runtime = defineRuntime({ entry: "./index.ts" });
    const splash = defineView({ name: "splash", entry: "./index.html" });
    const main = defineView({ name: "main", entry: "./index.html" });

    it("returns an ElectroConfig with runtime", () => {
        const result = defineConfig({ runtime });
        expect(result.runtime).toBe(runtime);
    });

    it("returns an ElectroConfig with runtime and views", () => {
        const result = defineConfig({ runtime, views: [splash, main] });
        expect(result.runtime).toBe(runtime);
        expect(result.views).toHaveLength(2);
    });

    it("defaults views to empty array when not provided", () => {
        const result = defineConfig({ runtime });
        expect(result.views).toEqual([]);
    });

    it("throws if views have duplicate names", () => {
        const dup = defineView({ name: "splash", entry: "./other.html" });
        expect(() => defineConfig({ runtime, views: [splash, dup] })).toThrow("splash");
    });
});
