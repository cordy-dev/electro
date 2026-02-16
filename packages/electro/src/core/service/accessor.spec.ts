/**
 * Contract: ServiceAccessor — scope-aware getService() implementation.
 *
 * Sections:
 *   1. Own-feature access (all scopes visible, returns API directly)
 *   2. Cross-feature access (only internal + exposed visible)
 *   3. Error cases
 */
import { describe, expect, it } from "vitest";
import type { EventAccessor } from "../event-bus/accessor";
import type { FeatureContext } from "../feature/types";
import { ServiceAccessor } from "./accessor";
import { ServiceScope } from "./enums";
import { ServiceManager } from "./manager";
import { Service } from "./service";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockCtx(): FeatureContext {
    return {
        signal: new AbortController().signal,
        logger: { debug() {}, warn() {}, error() {} },
        getService: () => {
            throw new Error("Not implemented");
        },
        getTask: () => {
            throw new Error("Not implemented");
        },
        getFeature: () => {
            throw new Error("Not implemented");
        },
        events: null as unknown as EventAccessor,
    };
}

function svc(id: string, scope: ServiceScope, api: Record<string, unknown>): Service<ServiceScope, unknown> {
    return new Service({ id, scope, api: () => api });
}

function startedManager(...services: Service<ServiceScope, unknown>[]): ServiceManager {
    const mgr = new ServiceManager(mockCtx());
    for (const s of services) mgr.register(s);
    mgr.startup();
    return mgr;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ServiceAccessor", () => {
    // ── 1. Own-feature access ─────────────────────────────────────────

    describe("own-feature access (no colon in name)", () => {
        it("returns API directly for own service", () => {
            const own = startedManager(svc("session", ServiceScope.EXPOSED, { login: () => "ok" }));
            const accessor = new ServiceAccessor(own, new Map());

            const result = accessor.get("session") as { login: () => string };
            expect(result.login()).toBe("ok");
        });

        it("returns API for private own service", () => {
            const own = startedManager(svc("store", ServiceScope.PRIVATE, { set: () => "done" }));
            const accessor = new ServiceAccessor(own, new Map());

            const result = accessor.get("store") as { set: () => string };
            expect(result.set()).toBe("done");
        });
    });

    // ── 2. Cross-feature access ───────────────────────────────────────

    describe("cross-feature access (featureId:serviceId)", () => {
        it("returns API for exposed cross-feature service", () => {
            const depManager = startedManager(svc("session", ServiceScope.EXPOSED, { login: () => "ok" }));
            const deps = new Map([["auth", depManager]]);
            const own = startedManager();
            const accessor = new ServiceAccessor(own, deps);

            const result = accessor.get("auth:session") as { login: () => string };
            expect(result.login()).toBe("ok");
        });

        it("returns API for internal cross-feature service", () => {
            const depManager = startedManager(svc("validate", ServiceScope.INTERNAL, { check: () => true }));
            const deps = new Map([["auth", depManager]]);
            const own = startedManager();
            const accessor = new ServiceAccessor(own, deps);

            const result = accessor.get("auth:validate") as { check: () => boolean };
            expect(result.check()).toBe(true);
        });

        it("throws when cross-feature service is PRIVATE", () => {
            const depManager = startedManager(svc("secret", ServiceScope.PRIVATE, { hash: () => "hashed" }));
            const deps = new Map([["auth", depManager]]);
            const own = startedManager();
            const accessor = new ServiceAccessor(own, deps);

            expect(() => accessor.get("auth:secret")).toThrow(
                'Service "secret" in feature "auth" is private and not accessible cross-feature',
            );
        });
    });

    // ── 3. Error cases ────────────────────────────────────────────────

    describe("errors", () => {
        it("throws for unknown own-feature service", () => {
            const own = startedManager();
            const accessor = new ServiceAccessor(own, new Map());

            expect(() => accessor.get("nonexistent")).toThrow('Service "nonexistent" not found in own feature');
        });

        it("throws for unknown dependency feature", () => {
            const own = startedManager();
            const accessor = new ServiceAccessor(own, new Map());

            expect(() => accessor.get("unknown:session")).toThrow('Feature "unknown" is not a declared dependency');
        });

        it("throws for unknown service in a known dependency", () => {
            const depManager = startedManager(svc("other", ServiceScope.EXPOSED, { x: 1 }));
            const deps = new Map([["auth", depManager]]);
            const own = startedManager();
            const accessor = new ServiceAccessor(own, deps);

            expect(() => accessor.get("auth:nonexistent")).toThrow('Service "nonexistent" not found in feature "auth"');
        });
    });
});
