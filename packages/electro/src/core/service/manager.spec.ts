/**
 * Contract: ServiceManager — per-feature registry and lifecycle coordinator.
 *
 * Sections:
 *   1. register / unregister
 *   2. startup / shutdown (bulk lifecycle)
 *   3. get (returns API directly)
 *   4. status / list
 */
import { describe, expect, it } from "vitest";
import type { EventAccessor } from "../event-bus/accessor";
import type { FeatureContext } from "../feature/types";
import { ServiceScope, ServiceStatus } from "./enums";
import { createService } from "./helpers";
import { ServiceManager } from "./manager";
import type { Service } from "./service";

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

function svc(id: string, scope?: ServiceScope, api: Record<string, unknown> = {}): Service<ServiceScope, unknown> {
    return createService(scope !== undefined ? { id, scope, api: () => api } : { id, api: () => api });
}

function createMgr(...services: Service<ServiceScope, unknown>[]): ServiceManager {
    const mgr = new ServiceManager(mockCtx());
    for (const s of services) mgr.register(s);
    return mgr;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ServiceManager", () => {
    // ── 1. register / unregister ──────────────────────────────────────

    describe("register", () => {
        it("stores service and exposes it via status", () => {
            const mgr = createMgr(svc("auth", ServiceScope.EXPOSED));
            const status = mgr.status("auth");
            expect(status.serviceId).toBe("auth");
            expect(status.state).toBe(ServiceStatus.REGISTERED);
        });

        it("throws on duplicate id", () => {
            const mgr = createMgr(svc("dup", ServiceScope.EXPOSED));
            expect(() => mgr.register(svc("dup", ServiceScope.PRIVATE))).toThrow('Duplicate service: "dup"');
        });

        it("defaults scope to PRIVATE when omitted", () => {
            const mgr = createMgr(svc("store"));
            const status = mgr.status("store");
            expect(status.scope).toBe(ServiceScope.PRIVATE);
        });
    });

    describe("unregister", () => {
        it("removes service and destroys it", () => {
            const mgr = createMgr(svc("session", ServiceScope.EXPOSED));
            mgr.startup();
            mgr.unregister("session");

            expect(() => mgr.status("session")).toThrow('Service "session" not found');
        });

        it("is a no-op for unknown ids", () => {
            const mgr = createMgr();
            expect(() => mgr.unregister("nonexistent")).not.toThrow();
        });
    });

    // ── 2. startup / shutdown ─────────────────────────────────────────

    describe("startup", () => {
        it("builds all services", () => {
            const mgr = createMgr(svc("a", ServiceScope.EXPOSED, { x: 1 }), svc("b", ServiceScope.PRIVATE, { y: 2 }));
            mgr.startup();

            const all = mgr.list();
            expect(all.every((s) => s.state === ServiceStatus.ACTIVE)).toBe(true);
        });

        it("is a no-op after shutdown", () => {
            const mgr = createMgr(svc("a", ServiceScope.EXPOSED, { x: 1 }));
            mgr.shutdown();
            mgr.startup();

            const all = mgr.list();
            expect(all.every((s) => s.state === ServiceStatus.DESTROYED)).toBe(true);
        });
    });

    describe("shutdown", () => {
        it("destroys all services", () => {
            const mgr = createMgr(svc("a", ServiceScope.EXPOSED), svc("b", ServiceScope.INTERNAL));
            mgr.startup();
            mgr.shutdown();

            const all = mgr.list();
            expect(all.every((s) => s.state === ServiceStatus.DESTROYED)).toBe(true);
        });
    });

    // ── 3. get ────────────────────────────────────────────────────────

    describe("get", () => {
        it("returns API and scope directly", () => {
            const mgr = createMgr(svc("session", ServiceScope.EXPOSED, { login: () => "ok" }));
            mgr.startup();

            const result = mgr.get("session");
            expect(result).not.toBeNull();
            expect(result!.scope).toBe(ServiceScope.EXPOSED);
            expect((result!.api as { login: () => string }).login()).toBe("ok");
        });

        it("returns null for unknown service id", () => {
            const mgr = createMgr();
            expect(mgr.get("nonexistent")).toBeNull();
        });

        it("returns null for services not yet built", () => {
            const mgr = createMgr(svc("a", ServiceScope.EXPOSED, { x: 1 }));
            // Not started — api() returns null
            expect(mgr.get("a")).toBeNull();
        });
    });

    // ── 4. status / list ──────────────────────────────────────────────

    describe("status", () => {
        it("returns status for a known service id", () => {
            const mgr = createMgr(svc("auth", ServiceScope.EXPOSED));
            const status = mgr.status("auth");
            expect(status).toEqual({
                serviceId: "auth",
                scope: ServiceScope.EXPOSED,
                state: ServiceStatus.REGISTERED,
            });
        });

        it("throws for unknown service id", () => {
            const mgr = createMgr();
            expect(() => mgr.status("unknown")).toThrow('Service "unknown" not found');
        });
    });

    describe("list", () => {
        it("returns all registered services", () => {
            const mgr = createMgr(svc("a", ServiceScope.EXPOSED), svc("b", ServiceScope.PRIVATE));

            const all = mgr.list();
            expect(all).toHaveLength(2);
        });

        it("returns empty array when nothing registered", () => {
            const mgr = createMgr();
            expect(mgr.list()).toEqual([]);
        });
    });
});
