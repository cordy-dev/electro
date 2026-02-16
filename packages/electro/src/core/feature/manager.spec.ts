/**
 * Contract: FeatureManager -- orchestrates Feature lifecycle via strict FSM transitions.
 *
 * Sections:
 *   1. register
 *   2. bootstrap
 *   3. shutdown
 *   4. enable / disable
 *   5. critical features
 *   6. dependency ordering
 *   7. error handling
 */
import { describe, expect, it, vi } from "vitest";
import { ServiceScope } from "../service/enums";
import { createService } from "../service/helpers";
import { createTask } from "../task/helpers";
import type { LoggerContext } from "../types";
import { FeatureStatus } from "./enums";
import { createFeature } from "./helpers";
import { FeatureManager } from "./manager";

// -- Helpers ------------------------------------------------------------------

function mockLogger(): LoggerContext {
    return {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

function createMgr(logger?: LoggerContext): FeatureManager {
    return new FeatureManager(logger ?? mockLogger());
}

// -- Tests --------------------------------------------------------------------

describe("FeatureManager", () => {
    // -- 1. register ----------------------------------------------------------

    describe("register", () => {
        it("registers a single feature (status -> REGISTERED)", () => {
            const mgr = createMgr();
            mgr.register(createFeature({ id: "alpha" }));
            const f = mgr.get("alpha");
            expect(f).toBeDefined();
            expect(f!.status).toBe(FeatureStatus.REGISTERED);
        });

        it("registers an array of features", () => {
            const mgr = createMgr();
            mgr.register([createFeature({ id: "a" }), createFeature({ id: "b" }), createFeature({ id: "c" })]);
            expect(mgr.get("a")).toBeDefined();
            expect(mgr.get("b")).toBeDefined();
            expect(mgr.get("c")).toBeDefined();
        });

        it("skips duplicate feature id with warning", () => {
            const logger = mockLogger();
            const mgr = createMgr(logger);
            mgr.register(createFeature({ id: "dup" }));
            mgr.register(createFeature({ id: "dup" }));
            expect(logger.warn).toHaveBeenCalledWith("FeatureManager", 'Feature "dup" is already registered. Skipping.');
            // Only one feature instance exists
            expect(mgr.get("dup")).toBeDefined();
        });

        it("throws when service id is claimed by two features", () => {
            const mgr = createMgr();
            const svc = createService({ id: "shared", scope: ServiceScope.PRIVATE, api: () => ({}) });
            mgr.register(createFeature({ id: "a", services: [svc] }));
            expect(() => {
                const svc2 = createService({ id: "shared", scope: ServiceScope.PRIVATE, api: () => ({}) });
                mgr.register(createFeature({ id: "b", services: [svc2] }));
            }).toThrow(/Service "shared" is already registered by feature "a"/);
        });

        it("throws when task id is claimed by two features", () => {
            const mgr = createMgr();
            const t = createTask({ id: "bg-job", execute: () => {} });
            mgr.register(createFeature({ id: "a", tasks: [t] }));
            expect(() => {
                const t2 = createTask({ id: "bg-job", execute: () => {} });
                mgr.register(createFeature({ id: "b", tasks: [t2] }));
            }).toThrow(/Task "bg-job" is already registered by feature "a"/);
        });

        it("throws on duplicate service id within the same feature", () => {
            const mgr = createMgr();
            const svc1 = createService({ id: "store", scope: ServiceScope.PRIVATE, api: () => ({}) });
            const svc2 = createService({ id: "store", scope: ServiceScope.EXPOSED, api: () => ({}) });
            expect(() => {
                mgr.register(createFeature({ id: "a", services: [svc1, svc2] }));
            }).toThrow(/Duplicate service "store" within feature "a"/);
        });

        it("does not register the feature when service conflict is detected", () => {
            const mgr = createMgr();
            const svc = createService({ id: "shared", scope: ServiceScope.PRIVATE, api: () => ({}) });
            mgr.register(createFeature({ id: "a", services: [svc] }));
            try {
                const svc2 = createService({ id: "shared", scope: ServiceScope.PRIVATE, api: () => ({}) });
                mgr.register(createFeature({ id: "b", services: [svc2] }));
            } catch {
                // expected
            }
            expect(mgr.get("b")).toBeUndefined();
        });
    });

    // -- 2. bootstrap ---------------------------------------------------------

    describe("bootstrap", () => {
        it("transitions features through initialize -> activate (status -> ACTIVATED)", async () => {
            const mgr = createMgr();
            mgr.register(createFeature({ id: "feat" }));
            await mgr.bootstrap();
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.ACTIVATED);
        });

        it("calls onInitialize and onActivate hooks in order", async () => {
            const calls: string[] = [];
            const mgr = createMgr();
            mgr.register(
                createFeature({
                    id: "feat",
                    onInitialize: async () => {
                        calls.push("init");
                    },
                    onActivate: async () => {
                        calls.push("activate");
                    },
                }),
            );
            await mgr.bootstrap();
            expect(calls).toEqual(["init", "activate"]);
        });

        it("initializes all before activating any (a:init, b:init, a:activate, b:activate)", async () => {
            const calls: string[] = [];
            const mgr = createMgr();
            mgr.register([
                createFeature({
                    id: "a",
                    onInitialize: async () => {
                        calls.push("a:init");
                    },
                    onActivate: async () => {
                        calls.push("a:activate");
                    },
                }),
                createFeature({
                    id: "b",
                    onInitialize: async () => {
                        calls.push("b:init");
                    },
                    onActivate: async () => {
                        calls.push("b:activate");
                    },
                }),
            ]);
            await mgr.bootstrap();
            expect(calls).toEqual(["a:init", "b:init", "a:activate", "b:activate"]);
        });
    });

    describe("bootstrap idempotency", () => {
        it("skips already-initialized features on second bootstrap", async () => {
            const initCalls: string[] = [];
            const mgr = createMgr();
            mgr.register(
                createFeature({
                    id: "feat",
                    onInitialize: async () => {
                        initCalls.push("init");
                    },
                }),
            );
            await mgr.bootstrap();
            expect(initCalls).toEqual(["init"]);

            // Second bootstrap — feature is already ACTIVATED, initialize should skip
            await mgr.bootstrap();
            expect(initCalls).toEqual(["init"]);
        });
    });

    // -- 3. shutdown ----------------------------------------------------------

    describe("shutdown", () => {
        it("deactivates then destroys all features (status -> DESTROYED)", async () => {
            const mgr = createMgr();
            mgr.register(createFeature({ id: "feat" }));
            await mgr.bootstrap();
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.ACTIVATED);

            await mgr.shutdown();
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.DESTROYED);
        });

        it("shutdown on never-bootstrapped features is a no-op", async () => {
            const mgr = createMgr();
            mgr.register(createFeature({ id: "feat" }));
            // Feature is in REGISTERED state, never initialized
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.REGISTERED);

            await mgr.shutdown();
            // destroy skips (REGISTERED is not DEACTIVATED or ERROR)
            // deactivate skips (REGISTERED is not ACTIVATED)
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.REGISTERED);
        });

        it("runs in reverse dependency order", async () => {
            const calls: string[] = [];
            const mgr = createMgr();
            mgr.register([
                createFeature({
                    id: "base",
                    onDeactivate: async () => {
                        calls.push("base:deactivate");
                    },
                    onDestroy: async () => {
                        calls.push("base:destroy");
                    },
                }),
                createFeature({
                    id: "dependent",
                    dependencies: ["base"],
                    onDeactivate: async () => {
                        calls.push("dependent:deactivate");
                    },
                    onDestroy: async () => {
                        calls.push("dependent:destroy");
                    },
                }),
            ]);
            await mgr.bootstrap();
            await mgr.shutdown();
            // dependent should be deactivated/destroyed before base
            expect(calls).toEqual(["dependent:deactivate", "base:deactivate", "dependent:destroy", "base:destroy"]);
        });
    });

    // -- 4. enable / disable --------------------------------------------------

    describe("enable / disable", () => {
        it("enable re-activates a deactivated feature", async () => {
            const mgr = createMgr();
            mgr.register(createFeature({ id: "feat" }));
            await mgr.bootstrap();
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.ACTIVATED);

            await mgr.disable("feat");
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.DEACTIVATED);

            await mgr.enable("feat");
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.ACTIVATED);
        });

        it("enable retries a feature in ERROR state", async () => {
            const mgr = createMgr();
            let shouldFail = true;
            mgr.register(
                createFeature({
                    id: "flaky",
                    onActivate: async () => {
                        if (shouldFail) throw new Error("boom");
                    },
                }),
            );
            await mgr.bootstrap();
            // Feature should be in ERROR (non-critical, activate failed)
            expect(mgr.get("flaky")!.status).toBe(FeatureStatus.ERROR);

            shouldFail = false;
            await mgr.enable("flaky");
            expect(mgr.get("flaky")!.status).toBe(FeatureStatus.ACTIVATED);
        });

        it("enable throws on unknown feature id", async () => {
            const mgr = createMgr();
            await expect(mgr.enable("nonexistent")).rejects.toThrow('Feature "nonexistent" not found');
        });

        it("disable deactivates an activated feature", async () => {
            const mgr = createMgr();
            mgr.register(createFeature({ id: "feat" }));
            await mgr.bootstrap();
            await mgr.disable("feat");
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.DEACTIVATED);
        });

        it("disable calls onDeactivate hook", async () => {
            const onDeactivate = vi.fn();
            const mgr = createMgr();
            mgr.register(createFeature({ id: "feat", onDeactivate }));
            await mgr.bootstrap();
            await mgr.disable("feat");
            expect(onDeactivate).toHaveBeenCalledOnce();
        });

        it("disable throws on unknown feature id", async () => {
            const mgr = createMgr();
            await expect(mgr.disable("nonexistent")).rejects.toThrow('Feature "nonexistent" not found');
        });
    });

    // -- 5. critical features -------------------------------------------------

    describe("critical features", () => {
        it("critical init failure throws and stops bootstrap", async () => {
            const mgr = createMgr();
            mgr.register(
                createFeature({
                    id: "critical-feat",
                    critical: true,
                    onInitialize: async () => {
                        throw new Error("init exploded");
                    },
                }),
            );
            await expect(mgr.bootstrap()).rejects.toThrow('Critical feature "critical-feat" failed to initialize');
        });

        it("critical activate failure throws and stops bootstrap", async () => {
            const mgr = createMgr();
            mgr.register(
                createFeature({
                    id: "critical-feat",
                    critical: true,
                    onActivate: async () => {
                        throw new Error("activate exploded");
                    },
                }),
            );
            await expect(mgr.bootstrap()).rejects.toThrow('Critical feature "critical-feat" failed to activate');
        });

        it("non-critical failure continues bootstrap (other features still ACTIVATED)", async () => {
            const mgr = createMgr();
            mgr.register([
                createFeature({
                    id: "broken",
                    onInitialize: async () => {
                        throw new Error("fail");
                    },
                }),
                createFeature({ id: "healthy" }),
            ]);
            await mgr.bootstrap();
            expect(mgr.get("broken")!.status).toBe(FeatureStatus.ERROR);
            expect(mgr.get("healthy")!.status).toBe(FeatureStatus.ACTIVATED);
        });
    });

    // -- 6. dependency ordering -----------------------------------------------

    describe("dependency ordering", () => {
        it("initializes dependencies before dependents", async () => {
            const calls: string[] = [];
            const mgr = createMgr();
            // Register dependent FIRST to prove ordering is by dependency, not insertion
            mgr.register([
                createFeature({
                    id: "child",
                    dependencies: ["parent"],
                    onInitialize: async () => {
                        calls.push("child:init");
                    },
                }),
                createFeature({
                    id: "parent",
                    onInitialize: async () => {
                        calls.push("parent:init");
                    },
                }),
            ]);
            await mgr.bootstrap();
            expect(calls.indexOf("parent:init")).toBeLessThan(calls.indexOf("child:init"));
        });

        it("detects circular dependencies", async () => {
            const mgr = createMgr();
            mgr.register([
                createFeature({ id: "a", dependencies: ["b"] }),
                createFeature({ id: "b", dependencies: ["a"] }),
            ]);
            await expect(mgr.bootstrap()).rejects.toThrow(/Circular dependency/);
        });

        it("throws on missing dependency", async () => {
            const mgr = createMgr();
            mgr.register(createFeature({ id: "orphan", dependencies: ["ghost"] }));
            await expect(mgr.bootstrap()).rejects.toThrow(/Missing dependency.*"ghost"/);
        });

        it("skips activation when dependency is in ERROR", async () => {
            const logger = mockLogger();
            const mgr = createMgr(logger);
            mgr.register([
                createFeature({
                    id: "base",
                    onInitialize: async () => {
                        throw new Error("base broke");
                    },
                }),
                createFeature({
                    id: "dependent",
                    dependencies: ["base"],
                }),
            ]);
            await mgr.bootstrap();
            // base failed init -> ERROR
            expect(mgr.get("base")!.status).toBe(FeatureStatus.ERROR);
            // dependent was initialized (since base init failure doesn't stop non-critical)
            // but activation should be skipped because dependency is in ERROR
            // dependent stays in READY (READY -> ERROR is illegal via FSM, so we just skip)
            expect(mgr.get("dependent")!.status).toBe(FeatureStatus.READY);
        });
    });

    // -- 7. error handling ----------------------------------------------------

    describe("error handling", () => {
        it("deactivate error sets feature to ERROR (then destroyed during shutdown)", async () => {
            const logger = mockLogger();
            const mgr = createMgr(logger);
            mgr.register(
                createFeature({
                    id: "feat",
                    onDeactivate: async () => {
                        throw new Error("deactivate failed");
                    },
                }),
            );
            await mgr.bootstrap();
            await mgr.shutdown();
            // deactivate threw -> DEACTIVATING -> ERROR, then shutdown destroy phase:
            // ERROR -> DESTROYING -> DESTROYED
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.DESTROYED);
            // Verify the deactivate error was logged
            expect(logger.error).toHaveBeenCalledWith("feat", "deactivate failed", {
                error: "deactivate failed",
            });
        });

        it("destroy error sets feature to ERROR", async () => {
            const mgr = createMgr();
            mgr.register(
                createFeature({
                    id: "feat",
                    onDestroy: async () => {
                        throw new Error("destroy failed");
                    },
                }),
            );
            await mgr.bootstrap();
            await mgr.shutdown();
            // destroy threw -> DESTROYING -> ERROR
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.ERROR);
        });

        it("logs String(err) when non-Error is thrown from initialize", async () => {
            const logger = mockLogger();
            const mgr = createMgr(logger);
            mgr.register(
                createFeature({
                    id: "feat",
                    onInitialize: async () => {
                        throw "init-string-error";
                    },
                }),
            );
            await mgr.bootstrap();
            expect(logger.error).toHaveBeenCalledWith("feat", "initialize failed", {
                error: "init-string-error",
            });
        });

        it("logs String(err) when non-Error is thrown from activate", async () => {
            const logger = mockLogger();
            const mgr = createMgr(logger);
            mgr.register(
                createFeature({
                    id: "feat",
                    onActivate: async () => {
                        throw "string-error";
                    },
                }),
            );
            await mgr.bootstrap();
            expect(logger.error).toHaveBeenCalledWith("feat", "activate failed", {
                error: "string-error",
            });
        });

        it("logs String(err) when non-Error is thrown from deactivate", async () => {
            const logger = mockLogger();
            const mgr = createMgr(logger);
            mgr.register(
                createFeature({
                    id: "feat",
                    onDeactivate: async () => {
                        throw "deactivate-string-error";
                    },
                }),
            );
            await mgr.bootstrap();
            await mgr.shutdown();
            expect(logger.error).toHaveBeenCalledWith("feat", "deactivate failed", {
                error: "deactivate-string-error",
            });
        });

        it("logs String(err) when non-Error is thrown from destroy", async () => {
            const logger = mockLogger();
            const mgr = createMgr(logger);
            mgr.register(
                createFeature({
                    id: "feat",
                    onDestroy: async () => {
                        throw "destroy-string-error";
                    },
                }),
            );
            await mgr.bootstrap();
            await mgr.shutdown();
            expect(logger.error).toHaveBeenCalledWith("feat", "destroy failed", {
                error: "destroy-string-error",
            });
        });

        it("ERROR features can still be destroyed during shutdown", async () => {
            const destroyCalled = vi.fn();
            const mgr = createMgr();
            mgr.register(
                createFeature({
                    id: "feat",
                    onActivate: async () => {
                        throw new Error("activate boom");
                    },
                    onDestroy: destroyCalled,
                }),
            );
            await mgr.bootstrap();
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.ERROR);

            await mgr.shutdown();
            // ERROR -> DESTROYING is valid in FSM, so destroy should run
            expect(destroyCalled).toHaveBeenCalledOnce();
            expect(mgr.get("feat")!.status).toBe(FeatureStatus.DESTROYED);
        });
    });
});
