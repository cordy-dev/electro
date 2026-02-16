import { describe, expect, it } from "vitest";
import { defineConfig } from "./define-config";
import { defineRuntime } from "./define-runtime";
import { defineWindow } from "./define-window";

describe("defineConfig()", () => {
    const runtime = defineRuntime({ entry: "./index.ts" });
    const splash = defineWindow({ name: "splash", entry: "./index.html" });
    const main = defineWindow({ name: "main", entry: "./index.html" });

    it("returns an ElectroConfig with runtime", () => {
        const result = defineConfig({ runtime });
        expect(result.runtime).toBe(runtime);
    });

    it("returns an ElectroConfig with runtime and windows", () => {
        const result = defineConfig({ runtime, windows: [splash, main] });
        expect(result.runtime).toBe(runtime);
        expect(result.windows).toHaveLength(2);
    });

    it("defaults windows to empty array when not provided", () => {
        const result = defineConfig({ runtime });
        expect(result.windows).toEqual([]);
    });

    it("throws if windows have duplicate names", () => {
        const dup = defineWindow({ name: "splash", entry: "./other.html" });
        expect(() => defineConfig({ runtime, windows: [splash, dup] })).toThrow("splash");
    });
});
