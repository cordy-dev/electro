/**
 * Contract: TaskManager — registry and lifecycle coordinator for Task instances.
 *
 * Responsibilities:
 *   - register / unregister tasks (duplicate guard, force-disable on removal)
 *   - bulk startup / shutdown with StopMode propagation
 *   - individual enable / disable by id
 *   - manual execution via start(taskId, payload?)
 *   - status / list queries
 *   - FeatureContext passthrough to tasks on enable
 *
 * Sections:
 *   1. register / unregister
 *   2. startup / shutdown (bulk lifecycle)
 *   3. enable / disable (individual task control)
 *   4. start (manual execution)
 *   5. status / list (queries)
 *   6. FeatureContext passthrough
 */
import { delay } from "es-toolkit";
import { describe, expect, it } from "vitest";
import type { EventAccessor } from "../event-bus/accessor";
import type { FeatureContext } from "../feature/types";
import { TaskOverlapStrategy, TaskStatus } from "./enums";
import { createTask } from "./helpers";
import { TaskManager } from "./manager";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Deferred promise for controlling async flow in tests. */
function blocker(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

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

/** Create a TaskManager with tasks registered but not started. */
function createMgr(...tasks: ReturnType<typeof createTask>[]): TaskManager {
    const mgr = new TaskManager(mockCtx());
    for (const t of tasks) mgr.register(t);
    return mgr;
}

/** Create a TaskManager with tasks registered and startup() called. */
function createActiveMgr(...tasks: ReturnType<typeof createTask>[]): TaskManager {
    const mgr = createMgr(...tasks);
    mgr.startup();
    return mgr;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TaskManager", () => {
    // ── 1. register / unregister ──────────────────────────────────────

    describe("register", () => {
        it("stores task and exposes it via status", () => {
            const mgr = createMgr(createTask({ id: "t1", autoStart: false, execute: async () => {} }));
            expect(mgr.status("t1").taskId).toBe("t1");
            expect(mgr.status("t1").state).toBe(TaskStatus.Registered);
        });

        it("throws on duplicate task id", () => {
            const mgr = createMgr(createTask({ id: "dup", autoStart: false, execute: async () => {} }));
            expect(() => mgr.register(createTask({ id: "dup", autoStart: false, execute: async () => {} }))).toThrow(
                "Duplicate task id",
            );
        });
    });

    describe("unregister", () => {
        it("removes task from registry", () => {
            const mgr = createMgr(createTask({ id: "rm1", autoStart: false, execute: async () => {} }));
            mgr.unregister("rm1");
            expect(() => mgr.status("rm1")).toThrow("not found");
        });

        it("allows re-register after unregister", () => {
            const mgr = createMgr(createTask({ id: "cycle", autoStart: false, execute: async () => {} }));
            mgr.unregister("cycle");
            mgr.register(createTask({ id: "cycle", autoStart: false, execute: async () => {} }));
            expect(mgr.status("cycle").taskId).toBe("cycle");
        });

        it("is a no-op for unknown task id", () => {
            const mgr = new TaskManager(mockCtx());
            expect(() => mgr.unregister("nope")).not.toThrow();
        });
    });

    // ── 2. startup / shutdown ─────────────────────────────────────────

    describe("startup", () => {
        it("enables all tasks — transitions to Scheduled", () => {
            const mgr = createMgr(
                createTask({ id: "a", autoStart: false, execute: async () => {} }),
                createTask({ id: "b", autoStart: false, execute: async () => {} }),
            );
            mgr.startup();
            expect(mgr.status("a").state).toBe(TaskStatus.Scheduled);
            expect(mgr.status("b").state).toBe(TaskStatus.Scheduled);
        });

        it("is a no-op after shutdown", () => {
            const mgr = createMgr(createTask({ id: "t1", autoStart: false, execute: async () => {} }));
            mgr.startup();
            mgr.shutdown();
            expect(mgr.status("t1").state).toBe(TaskStatus.Stopped);

            mgr.startup();
            expect(mgr.status("t1").state).toBe(TaskStatus.Stopped);
        });
    });

    describe("shutdown", () => {
        it("stops all tasks", () => {
            const mgr = createActiveMgr(
                createTask({ id: "a", autoStart: false, execute: async () => {} }),
                createTask({ id: "b", autoStart: false, execute: async () => {} }),
            );
            mgr.shutdown();
            expect(mgr.status("a").state).toBe(TaskStatus.Stopped);
            expect(mgr.status("b").state).toBe(TaskStatus.Stopped);
        });

        it("graceful mode lets running tasks finish", async () => {
            const b = blocker();
            let completed = false;
            const mgr = createActiveMgr(
                createTask({
                    id: "t1",
                    autoStart: false,
                    execute: async () => {
                        await b.promise;
                        completed = true;
                    },
                }),
            );
            const p = mgr.start("t1");
            await delay(5);
            mgr.shutdown("graceful");
            b.resolve();
            await p;
            expect(completed).toBe(true);
        });

        it("blocks new executions after shutdown", async () => {
            let ran = false;
            const mgr = createActiveMgr(
                createTask({
                    id: "t1",
                    autoStart: false,
                    execute: async () => {
                        ran = true;
                    },
                }),
            );
            mgr.shutdown();
            await mgr.start("t1");
            expect(ran).toBe(false);
        });

        it("clears queued tasks", async () => {
            const b = blocker();
            let runCount = 0;
            const mgr = createActiveMgr(
                createTask({
                    id: "t1",
                    autoStart: false,
                    overlap: TaskOverlapStrategy.Queue,
                    execute: async () => {
                        if (runCount === 0) await b.promise;
                        runCount++;
                    },
                }),
            );
            const p = mgr.start("t1");
            await delay(5);
            void mgr.start("t1");
            expect(mgr.status("t1").queueSize).toBeGreaterThan(0);
            mgr.shutdown();
            expect(mgr.status("t1").queueSize).toBe(0);
            b.resolve();
            await p;
            await delay(15);
            expect(runCount).toBe(1);
        });
    });

    // ── 3. enable / disable ───────────────────────────────────────────

    describe("enable", () => {
        it("enables a specific task", () => {
            const mgr = createMgr(createTask({ id: "t1", autoStart: false, execute: async () => {} }));
            mgr.enable("t1");
            expect(mgr.status("t1").state).toBe(TaskStatus.Scheduled);
        });

        it("throws on unknown task id", () => {
            const mgr = new TaskManager(mockCtx());
            expect(() => mgr.enable("nope")).toThrow("not found");
        });
    });

    describe("disable", () => {
        it("disables a specific task", () => {
            const mgr = createActiveMgr(createTask({ id: "t1", autoStart: false, execute: async () => {} }));
            mgr.disable("t1");
            expect(mgr.status("t1").state).toBe(TaskStatus.Stopped);
        });

        it("force mode aborts running task", async () => {
            const b = blocker();
            let aborted = false;
            const mgr = createActiveMgr(
                createTask({
                    id: "t1",
                    autoStart: false,
                    execute: async (_ctx, _p, execCtx) => {
                        execCtx.signal.addEventListener("abort", () => {
                            aborted = true;
                        });
                        await b.promise;
                    },
                }),
            );
            const p = mgr.start("t1");
            await delay(5);
            mgr.disable("t1", "force");
            expect(aborted).toBe(true);
            b.resolve();
            await p;
            expect(mgr.status("t1").state).toBe(TaskStatus.Stopped);
        });

        it("throws on unknown task id", () => {
            const mgr = new TaskManager(mockCtx());
            expect(() => mgr.disable("nope")).toThrow("not found");
        });
    });

    // ── 4. start ──────────────────────────────────────────────────────

    describe("start", () => {
        it("delegates to task.start with payload", async () => {
            let received: unknown;
            const mgr = createActiveMgr(
                createTask({
                    id: "t1",
                    autoStart: false,
                    execute: async (_ctx, payload) => {
                        received = payload;
                    },
                }),
            );
            await mgr.start("t1", { key: "val" });
            expect(received).toEqual({ key: "val" });
        });

        it("throws on unknown task id", async () => {
            const mgr = new TaskManager(mockCtx());
            await expect(mgr.start("nope")).rejects.toThrow("not found");
        });
    });

    // ── 5. status / list ──────────────────────────────────────────────

    describe("status", () => {
        it("returns TaskStatusInfo from the task", () => {
            const mgr = createMgr(createTask({ id: "t1", autoStart: false, execute: async () => {} }));
            const s = mgr.status("t1");
            expect(s.taskId).toBe("t1");
            expect(s.state).toBe(TaskStatus.Registered);
        });

        it("throws on unknown task id", () => {
            const mgr = new TaskManager(mockCtx());
            expect(() => mgr.status("nope")).toThrow("not found");
        });
    });

    describe("list", () => {
        it("returns status for all registered tasks", () => {
            const mgr = createMgr(
                createTask({ id: "a", autoStart: false, execute: async () => {} }),
                createTask({ id: "b", autoStart: false, execute: async () => {} }),
                createTask({ id: "c", autoStart: false, execute: async () => {} }),
            );
            const all = mgr.list();
            expect(all).toHaveLength(3);
            expect(all.map((s) => s.taskId).sort()).toEqual(["a", "b", "c"]);
        });

        it("returns empty array when no tasks registered", () => {
            const mgr = new TaskManager(mockCtx());
            expect(mgr.list()).toEqual([]);
        });
    });

    // ── 6. FeatureContext passthrough ──────────────────────────────────

    describe("FeatureContext passthrough", () => {
        it("passes its FeatureContext to tasks on enable", async () => {
            const ctx = mockCtx();
            const mgr = new TaskManager(ctx);
            let received: FeatureContext | undefined;
            mgr.register(
                createTask({
                    id: "t1",
                    autoStart: false,
                    execute: async (featureCtx) => {
                        received = featureCtx;
                    },
                }),
            );
            mgr.startup();
            await mgr.start("t1");
            expect(received).toBe(ctx);
        });
    });
});
