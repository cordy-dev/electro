/**
 * Contract: Service — single unit with one id, one scope, one factory.
 *
 * Lifecycle: Registered → Active (build) → Destroyed (destroy)
 *
 * Sections:
 *   1. Construction & identity
 *   2. build (lifecycle)
 *   3. destroy (lifecycle)
 *   4. api() accessor
 *   5. status() snapshot
 */
import { describe, expect, it } from "vitest";
import type { EventAccessor } from "../event-bus/accessor";
import type { FeatureContext } from "../feature/types";
import { ServiceScope, ServiceStatus } from "./enums";
import { createService } from "./helpers";
import { Service } from "./service";
import type { ServiceConfig } from "./types";

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

function createSvc<TApi>(
    overrides: Partial<ServiceConfig<ServiceScope, TApi>> & {
        api: ServiceConfig<ServiceScope, TApi>["api"];
    },
): Service<ServiceScope, TApi> {
    return new Service({
        id: overrides.id ?? "test-svc",
        scope: overrides.scope ?? ServiceScope.EXPOSED,
        api: overrides.api,
    });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createService validation", () => {
    it("throws when id is empty string", () => {
        expect(() => createService({ id: "", scope: ServiceScope.EXPOSED, api: () => ({}) })).toThrow(
            "Service must have an id",
        );
    });
});

describe("Service", () => {
    // ── 1. Construction & identity ────────────────────────────────────

    describe("constructor", () => {
        it("exposes id and scope from config", () => {
            const svc = createSvc({
                id: "auth",
                scope: ServiceScope.PRIVATE,
                api: () => ({ hash: () => "x" }),
            });
            expect(svc.id).toBe("auth");
            expect(svc.scope).toBe(ServiceScope.PRIVATE);
        });

        it("initial status is Registered", () => {
            const svc = createSvc({ api: () => ({}) });
            expect(svc.status().state).toBe(ServiceStatus.REGISTERED);
        });
    });

    // ── 2. build ──────────────────────────────────────────────────────

    describe("build", () => {
        it("calls factory and transitions to Active", () => {
            let called = false;
            const svc = createSvc({
                api: () => {
                    called = true;
                    return { greet: () => "hi" };
                },
            });

            svc.build(mockCtx());

            expect(called).toBe(true);
            expect(svc.status().state).toBe(ServiceStatus.ACTIVE);
        });

        it("is idempotent — second call is a no-op", () => {
            let callCount = 0;
            const svc = createSvc({
                api: () => {
                    callCount++;
                    return { x: callCount };
                },
            });

            svc.build(mockCtx());
            svc.build(mockCtx());

            expect(callCount).toBe(1);
            expect(svc.api()).toEqual({ x: 1 });
        });

        it("throws if called after destroy", () => {
            const svc = createSvc({ api: () => ({}) });
            svc.build(mockCtx());
            svc.destroy();

            expect(() => svc.build(mockCtx())).toThrow("destroyed and cannot be rebuilt");
        });

        it("passes context to factory", () => {
            const ctx = mockCtx();
            let receivedCtx: FeatureContext | null = null;
            const svc = createSvc({
                api: (c) => {
                    receivedCtx = c;
                    return {};
                },
            });

            svc.build(ctx);
            expect(receivedCtx).toBe(ctx);
        });
    });

    // ── 3. destroy ────────────────────────────────────────────────────

    describe("destroy", () => {
        it("clears api and transitions to Destroyed", () => {
            const svc = createSvc({ api: () => ({ val: 1 }) });
            svc.build(mockCtx());
            svc.destroy();

            expect(svc.api()).toBeNull();
            expect(svc.status().state).toBe(ServiceStatus.DESTROYED);
        });

        it("is idempotent — safe to call multiple times", () => {
            const svc = createSvc({ api: () => ({}) });
            svc.build(mockCtx());
            svc.destroy();
            svc.destroy();

            expect(svc.status().state).toBe(ServiceStatus.DESTROYED);
        });

        it("can be called before build", () => {
            const svc = createSvc({ api: () => ({}) });
            svc.destroy();
            expect(svc.status().state).toBe(ServiceStatus.DESTROYED);
        });
    });

    // ── 4. api() accessor ─────────────────────────────────────────────

    describe("api", () => {
        it("returns null before build", () => {
            const svc = createSvc({ api: () => ({ method: () => 42 }) });
            expect(svc.api()).toBeNull();
        });

        it("returns factory result after build", () => {
            const api = { method: () => 42 };
            const svc = createSvc({ api: () => api });
            svc.build(mockCtx());
            expect(svc.api()).toBe(api);
        });

        it("returns null after destroy", () => {
            const svc = createSvc({ api: () => ({ method: () => 42 }) });
            svc.build(mockCtx());
            svc.destroy();
            expect(svc.api()).toBeNull();
        });
    });

    // ── 5. status() snapshot ──────────────────────────────────────────

    describe("status", () => {
        it("returns correct shape with serviceId, scope, and state", () => {
            const svc = createSvc({
                id: "session",
                scope: ServiceScope.INTERNAL,
                api: () => ({}),
            });

            const info = svc.status();
            expect(info).toEqual({
                serviceId: "session",
                scope: ServiceScope.INTERNAL,
                state: ServiceStatus.REGISTERED,
            });
        });

        it("reflects Active state after build", () => {
            const svc = createSvc({ api: () => ({}) });
            svc.build(mockCtx());
            expect(svc.status().state).toBe(ServiceStatus.ACTIVE);
        });

        it("reflects Destroyed state after destroy", () => {
            const svc = createSvc({ api: () => ({}) });
            svc.build(mockCtx());
            svc.destroy();
            expect(svc.status().state).toBe(ServiceStatus.DESTROYED);
        });
    });
});
