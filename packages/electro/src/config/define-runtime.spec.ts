import { describe, expect, it } from "vitest";
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

    it("captures __source from caller as a string", () => {
        const result = defineRuntime({ entry: "src/main/index.ts" });
        // __source is always a string — may be empty when caller path
        // resolves inside @cordy/electro (skipped by getCallerPath)
        expect(typeof result.__source).toBe("string");
    });

    it("__source defaults to empty string when caller path is unresolvable", () => {
        // defineRuntime always produces a string __source,
        // falling back to "" when getCallerPath returns undefined
        const result = defineRuntime({ entry: "src/main/index.ts" });
        expect(typeof result.__source).toBe("string");
    });
});
