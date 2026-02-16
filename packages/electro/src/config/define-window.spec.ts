import { describe, expect, it, vi } from "vitest";
import { defineWindow } from "./define-window";

describe("defineWindow", () => {
    it("returns a WindowDefinition with required fields (name, entry)", () => {
        const result = defineWindow({ name: "main", entry: "src/renderer/index.html" });
        expect(result.name).toBe("main");
        expect(result.entry).toBe("src/renderer/index.html");
    });

    it("preserves all optional fields when provided", () => {
        const result = defineWindow({
            name: "settings",
            entry: "src/renderer/settings.html",
            features: ["theme", "i18n"],
            vite: { resolve: { alias: { "@": "/src" } } },
            preload: "src/preload/settings.ts",
            lifecycle: "multi",
            autoShow: true,
            behavior: { close: "destroy" },
            window: { width: 800, height: 600 },
        });

        expect(result.features).toEqual(["theme", "i18n"]);
        expect(result.vite).toEqual({ resolve: { alias: { "@": "/src" } } });
        expect(result.preload).toBe("src/preload/settings.ts");
        expect(result.lifecycle).toBe("multi");
        expect(result.autoShow).toBe(true);
        expect(result.behavior).toEqual({ close: "destroy" });
        expect(result.window).toEqual({ width: 800, height: 600 });
    });

    it("defaults lifecycle to 'singleton' when not provided", () => {
        const result = defineWindow({ name: "main", entry: "src/renderer/index.html" });
        expect(result.lifecycle).toBe("singleton");
    });

    it("defaults autoShow to false when not provided", () => {
        const result = defineWindow({ name: "main", entry: "src/renderer/index.html" });
        expect(result.autoShow).toBe(false);
    });

    it("defaults behavior.close to 'hide' when not provided", () => {
        const result = defineWindow({ name: "main", entry: "src/renderer/index.html" });
        expect(result.behavior).toEqual({ close: "hide" });
    });

    it("throws if name is empty", () => {
        expect(() => defineWindow({ name: "", entry: "src/renderer/index.html" })).toThrow(
            "[electro] defineWindow: name must be a non-empty string",
        );
    });

    it("throws if entry is empty", () => {
        expect(() => defineWindow({ name: "main", entry: "" })).toThrow(
            "[electro] defineWindow: entry must be a non-empty string",
        );
    });

    it("throws if name contains invalid characters", () => {
        expect(() => defineWindow({ name: "my window!", entry: "src/renderer/index.html" })).toThrow(
            '[electro] defineWindow: name "my window!" is invalid',
        );

        expect(() => defineWindow({ name: "window.main", entry: "src/renderer/index.html" })).toThrow(
            '[electro] defineWindow: name "window.main" is invalid',
        );

        expect(() => defineWindow({ name: "_leading", entry: "src/renderer/index.html" })).toThrow(
            '[electro] defineWindow: name "_leading" is invalid',
        );

        expect(() => defineWindow({ name: "-leading", entry: "src/renderer/index.html" })).toThrow(
            '[electro] defineWindow: name "-leading" is invalid',
        );
    });

    it("allows names with alphanumeric, dashes, and underscores", () => {
        expect(() => defineWindow({ name: "main", entry: "e.html" })).not.toThrow();
        expect(() => defineWindow({ name: "my-window", entry: "e.html" })).not.toThrow();
        expect(() => defineWindow({ name: "my_window", entry: "e.html" })).not.toThrow();
        expect(() => defineWindow({ name: "MyWindow2", entry: "e.html" })).not.toThrow();
        expect(() => defineWindow({ name: "a", entry: "e.html" })).not.toThrow();
        expect(() => defineWindow({ name: "A1_b-c", entry: "e.html" })).not.toThrow();
    });

    it("throws if lifecycle is 'multi' and behavior.close is 'hide'", () => {
        expect(() =>
            defineWindow({
                name: "popup",
                entry: "src/renderer/popup.html",
                lifecycle: "multi",
                behavior: { close: "hide" },
            }),
        ).toThrow('[electro] defineWindow: behavior.close "hide" is only allowed with lifecycle "singleton"');
    });

    it("allows lifecycle 'multi' with behavior.close 'destroy'", () => {
        const result = defineWindow({
            name: "popup",
            entry: "src/renderer/popup.html",
            lifecycle: "multi",
            behavior: { close: "destroy" },
        });
        expect(result.lifecycle).toBe("multi");
        expect(result.behavior).toEqual({ close: "destroy" });
    });

    it("defaults behavior.close to 'destroy' when lifecycle is 'multi' and no behavior provided", () => {
        const result = defineWindow({
            name: "popup",
            entry: "src/renderer/popup.html",
            lifecycle: "multi",
        });
        expect(result.behavior).toEqual({ close: "destroy" });
    });

    it("captures __source from caller", () => {
        const result = defineWindow({ name: "main", entry: "src/renderer/index.html" });
        expect(typeof result.__source).toBe("string");
        expect(result.__source.length).toBeGreaterThan(0);
    });

    it("falls back to empty __source when getCallerPath returns undefined", async () => {
        vi.resetModules();
        vi.doMock("./caller", () => ({ getCallerPath: () => undefined }));
        const { defineWindow: fresh } = await import("./define-window");
        const result = fresh({ name: "main", entry: "src/renderer/index.html" });
        expect(result.__source).toBe("");
    });
});
