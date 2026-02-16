import { describe, expect, it, vi } from "vitest";
import { defineRuntime } from "./define-runtime";

describe("defineRuntime", () => {
    it("returns a RuntimeDefinition with the given entry", () => {
        const result = defineRuntime({ entry: "src/main/index.ts" });
        expect(result.entry).toBe("src/main/index.ts");
    });

    it("preserves vite config when provided", () => {
        const viteConfig = { resolve: { alias: { "@": "/src" } } };
        const result = defineRuntime({
            entry: "src/main/index.ts",
            vite: viteConfig,
        });
        expect(result.vite).toEqual(viteConfig);
    });

    it("returns undefined vite when not provided", () => {
        const result = defineRuntime({ entry: "src/main/index.ts" });
        expect(result.vite).toBeUndefined();
    });

    it("throws if entry is an empty string", () => {
        expect(() => defineRuntime({ entry: "" })).toThrow("[electro] defineRuntime: entry must be a non-empty string");
    });

    it("throws if entry is whitespace-only", () => {
        expect(() => defineRuntime({ entry: "   " })).toThrow(
            "[electro] defineRuntime: entry must be a non-empty string",
        );
    });

    it("captures __source from caller as a non-empty string", () => {
        const result = defineRuntime({ entry: "src/main/index.ts" });
        expect(typeof result.__source).toBe("string");
        expect(result.__source.length).toBeGreaterThan(0);
    });

    it("falls back to empty __source when getCallerPath returns undefined", async () => {
        vi.resetModules();
        vi.doMock("./caller", () => ({ getCallerPath: () => undefined }));
        const { defineRuntime: fresh } = await import("./define-runtime");
        const result = fresh({ entry: "src/main/index.ts" });
        expect(result.__source).toBe("");
    });
});
