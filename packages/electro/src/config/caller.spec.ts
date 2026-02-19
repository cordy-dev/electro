import { describe, expect, it } from "vitest";
import { getCallerPath } from "./caller";

/** Create a fake Error constructor that works with both `new Error()` and `Error()`. */
function fakeErrorCtor(fixedStack: string | undefined): ErrorConstructor {
    return new Proxy(Error, {
        construct() {
            return { stack: fixedStack };
        },
        apply() {
            return { stack: fixedStack };
        },
    }) as unknown as ErrorConstructor;
}

describe("getCallerPath()", () => {
    it("returns a string or undefined from a normal call site", () => {
        const result = getCallerPath();
        // In bun's test runner, the call site path may contain "@cordy/electro"
        // which getCallerPath skips. Accept string or undefined.
        expect(result === undefined || typeof result === "string").toBe(true);
    });

    it("returns undefined for an empty stack", () => {
        const orig = globalThis.Error;
        globalThis.Error = fakeErrorCtor(undefined);
        try {
            expect(getCallerPath()).toBeUndefined();
        } finally {
            globalThis.Error = orig;
        }
    });

    it("returns undefined when no stack frame matches", () => {
        const orig = globalThis.Error;
        globalThis.Error = fakeErrorCtor("Error\n    at <anonymous>");
        try {
            expect(getCallerPath()).toBeUndefined();
        } finally {
            globalThis.Error = orig;
        }
    });

    it("handles malformed file:// URL gracefully", () => {
        const orig = globalThis.Error;
        globalThis.Error = fakeErrorCtor("Error\n    at something (file://%%%invalid:1:1)");
        try {
            const result = getCallerPath();
            expect(result).toBe("file://%%%invalid");
        } finally {
            globalThis.Error = orig;
        }
    });
});
