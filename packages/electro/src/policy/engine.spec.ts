import { describe, expect, it } from "vitest";
import type { ViewDefinition } from "../config/types";
import { PolicyEngine } from "./engine";
import { PolicyDecision } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────

function view(name: string, features?: string[]): ViewDefinition {
    return {
        name,
        entry: "./index.html",
        features,
        __source: "/fake",
    } as ViewDefinition;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("PolicyEngine", () => {
    describe("check", () => {
        it("returns ALLOWED when feature is in view's features list", () => {
            const engine = new PolicyEngine([view("main", ["auth", "settings"])]);
            const result = engine.check("main", "auth");

            expect(result.decision).toBe(PolicyDecision.ALLOWED);
            expect(result.viewName).toBe("main");
            expect(result.featureId).toBe("auth");
        });

        it("returns ACCESS_DENIED when feature is not in view's features list", () => {
            const engine = new PolicyEngine([view("main", ["auth"])]);
            const result = engine.check("main", "billing");

            expect(result.decision).toBe(PolicyDecision.ACCESS_DENIED);
        });

        it("returns ACCESS_DENIED when view has empty features list", () => {
            const engine = new PolicyEngine([view("main", [])]);
            const result = engine.check("main", "auth");

            expect(result.decision).toBe(PolicyDecision.ACCESS_DENIED);
        });

        it("returns ACCESS_DENIED when view has no features defined (undefined)", () => {
            const engine = new PolicyEngine([view("splash")]);
            const result = engine.check("splash", "auth");

            expect(result.decision).toBe(PolicyDecision.ACCESS_DENIED);
        });

        it("returns VIEW_NOT_FOUND for unknown view name", () => {
            const engine = new PolicyEngine([view("main", ["auth"])]);
            const result = engine.check("unknown", "auth");

            expect(result.decision).toBe(PolicyDecision.VIEW_NOT_FOUND);
        });
    });

    describe("canAccess", () => {
        it("returns true when feature is allowed", () => {
            const engine = new PolicyEngine([view("main", ["auth"])]);
            expect(engine.canAccess("main", "auth")).toBe(true);
        });

        it("returns false when feature is denied", () => {
            const engine = new PolicyEngine([view("main", ["auth"])]);
            expect(engine.canAccess("main", "billing")).toBe(false);
        });

        it("returns false for unknown view", () => {
            const engine = new PolicyEngine([view("main", ["auth"])]);
            expect(engine.canAccess("unknown", "auth")).toBe(false);
        });
    });

    describe("getAllowedFeatures", () => {
        it("returns the features list for a known view", () => {
            const engine = new PolicyEngine([view("main", ["auth", "settings"])]);
            expect(engine.getAllowedFeatures("main")).toEqual(["auth", "settings"]);
        });

        it("returns empty array when view has no features", () => {
            const engine = new PolicyEngine([view("splash")]);
            expect(engine.getAllowedFeatures("splash")).toEqual([]);
        });

        it("throws for unknown view", () => {
            const engine = new PolicyEngine([view("main", ["auth"])]);
            expect(() => engine.getAllowedFeatures("unknown")).toThrow(
                'View "unknown" is not registered in the policy engine',
            );
        });
    });

    describe("getViewNames", () => {
        it("returns all registered view names", () => {
            const engine = new PolicyEngine([
                view("main", ["auth"]),
                view("splash", []),
                view("settings", ["settings"]),
            ]);
            expect(engine.getViewNames()).toEqual(["main", "splash", "settings"]);
        });

        it("returns empty array when no views", () => {
            const engine = new PolicyEngine([]);
            expect(engine.getViewNames()).toEqual([]);
        });
    });

    describe("multiple views", () => {
        it("enforces per-view policy independently", () => {
            const engine = new PolicyEngine([
                view("main", ["auth", "settings", "billing"]),
                view("splash", ["auth"]),
                view("admin", ["auth", "billing"]),
            ]);

            expect(engine.canAccess("main", "billing")).toBe(true);
            expect(engine.canAccess("splash", "billing")).toBe(false);
            expect(engine.canAccess("admin", "billing")).toBe(true);
            expect(engine.canAccess("admin", "settings")).toBe(false);
        });
    });
});
