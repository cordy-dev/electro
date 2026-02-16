import { describe, expect, it, vi } from "vitest";
import { getCallerPath } from "./caller";

describe("getCallerPath()", () => {
    it("returns a string from a normal call site", () => {
        const result = getCallerPath();
        expect(typeof result).toBe("string");
        expect(result!.length).toBeGreaterThan(0);
    });

    it("returns undefined when Error.stack is undefined", () => {
        const orig = Error;
        vi.stubGlobal(
            "Error",
            class {
                stack = undefined;
            },
        );
        try {
            expect(getCallerPath()).toBeUndefined();
        } finally {
            vi.stubGlobal("Error", orig);
        }
    });

    it("returns undefined when no stack frame matches", () => {
        const orig = Error;
        vi.stubGlobal(
            "Error",
            class {
                stack = "Error\n    at <anonymous>";
            },
        );
        try {
            expect(getCallerPath()).toBeUndefined();
        } finally {
            vi.stubGlobal("Error", orig);
        }
    });

    it("handles malformed file:// URL gracefully", () => {
        const orig = Error;
        vi.stubGlobal(
            "Error",
            class {
                stack = "Error\n    at something (file://%%%invalid:1:1)";
            },
        );
        try {
            const result = getCallerPath();
            expect(result).toBe("file://%%%invalid");
        } finally {
            vi.stubGlobal("Error", orig);
        }
    });
});
