import { describe, expect, it } from "vitest";
import type { WindowDefinition } from "../config/types";
import { PolicyEngine } from "./engine";
import { PolicyDecision } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────

function win(name: string, features?: string[]): WindowDefinition {
    return {
        name,
        entry: "./index.html",
        features,
        __source: "/fake",
    } as WindowDefinition;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("PolicyEngine", () => {
    describe("check", () => {
        it("returns ALLOWED when feature is in window's features list", () => {
            const engine = new PolicyEngine([win("main", ["auth", "settings"])]);
            const result = engine.check("main", "auth");

            expect(result.decision).toBe(PolicyDecision.ALLOWED);
            expect(result.windowName).toBe("main");
            expect(result.featureId).toBe("auth");
        });

        it("returns ACCESS_DENIED when feature is not in window's features list", () => {
            const engine = new PolicyEngine([win("main", ["auth"])]);
            const result = engine.check("main", "billing");

            expect(result.decision).toBe(PolicyDecision.ACCESS_DENIED);
        });

        it("returns ACCESS_DENIED when window has empty features list", () => {
            const engine = new PolicyEngine([win("main", [])]);
            const result = engine.check("main", "auth");

            expect(result.decision).toBe(PolicyDecision.ACCESS_DENIED);
        });

        it("returns ACCESS_DENIED when window has no features defined (undefined)", () => {
            const engine = new PolicyEngine([win("splash")]);
            const result = engine.check("splash", "auth");

            expect(result.decision).toBe(PolicyDecision.ACCESS_DENIED);
        });

        it("returns WINDOW_NOT_FOUND for unknown window name", () => {
            const engine = new PolicyEngine([win("main", ["auth"])]);
            const result = engine.check("unknown", "auth");

            expect(result.decision).toBe(PolicyDecision.WINDOW_NOT_FOUND);
        });
    });

    describe("canAccess", () => {
        it("returns true when feature is allowed", () => {
            const engine = new PolicyEngine([win("main", ["auth"])]);
            expect(engine.canAccess("main", "auth")).toBe(true);
        });

        it("returns false when feature is denied", () => {
            const engine = new PolicyEngine([win("main", ["auth"])]);
            expect(engine.canAccess("main", "billing")).toBe(false);
        });

        it("returns false for unknown window", () => {
            const engine = new PolicyEngine([win("main", ["auth"])]);
            expect(engine.canAccess("unknown", "auth")).toBe(false);
        });
    });

    describe("getAllowedFeatures", () => {
        it("returns the features list for a known window", () => {
            const engine = new PolicyEngine([win("main", ["auth", "settings"])]);
            expect(engine.getAllowedFeatures("main")).toEqual(["auth", "settings"]);
        });

        it("returns empty array when window has no features", () => {
            const engine = new PolicyEngine([win("splash")]);
            expect(engine.getAllowedFeatures("splash")).toEqual([]);
        });

        it("throws for unknown window", () => {
            const engine = new PolicyEngine([win("main", ["auth"])]);
            expect(() => engine.getAllowedFeatures("unknown")).toThrow(
                'Window "unknown" is not registered in the policy engine',
            );
        });
    });

    describe("getWindowNames", () => {
        it("returns all registered window names", () => {
            const engine = new PolicyEngine([win("main", ["auth"]), win("splash", []), win("settings", ["settings"])]);
            expect(engine.getWindowNames()).toEqual(["main", "splash", "settings"]);
        });

        it("returns empty array when no windows", () => {
            const engine = new PolicyEngine([]);
            expect(engine.getWindowNames()).toEqual([]);
        });
    });

    describe("multiple windows", () => {
        it("enforces per-window policy independently", () => {
            const engine = new PolicyEngine([
                win("main", ["auth", "settings", "billing"]),
                win("splash", ["auth"]),
                win("admin", ["auth", "billing"]),
            ]);

            expect(engine.canAccess("main", "billing")).toBe(true);
            expect(engine.canAccess("splash", "billing")).toBe(false);
            expect(engine.canAccess("admin", "billing")).toBe(true);
            expect(engine.canAccess("admin", "settings")).toBe(false);
        });
    });
});
