/**
 * Contract: Task — single executable unit with lifecycle, overlap, retry, timeout, and cron.
 *
 * State machine: Registered → Scheduled → Running → Scheduled | Failed | Stopped
 *
 * Sections:
 *   1. Construction & identity
 *   2. enable / disable (lifecycle)
 *   3. start (manual execution)
 *   4. status (observable state)
 *   5. State machine transitions
 *   6. Overlap strategies (skip / queue / parallel)
 *   7. Deduplication
 *   8. Retry (fixed / exponential)
 *   9. Timeout with abort propagation
 *  10. Cron scheduling
 */
import { delay } from "es-toolkit";
import { describe, expect, it } from "vitest";
import type { EventAccessor } from "../event-bus/accessor";
import type { FeatureContext } from "../feature/types";
import { TaskOverlapStrategy, TaskRetryStrategy, TaskStatus } from "./enums";
import { createTask as createTaskHelper } from "./helpers";
import { Task } from "./task";
import type { TaskConfig, TaskExecutionContext } from "./types";

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

function createTask<TPayload = void>(
    overrides: Partial<TaskConfig<string, TPayload>> & { execute: TaskConfig<string, TPayload>["execute"] },
): Task<string, TPayload> {
    return new Task<string, TPayload>({
        id: overrides.id ?? "test-task",
        ...overrides,
    });
}

function createEnabled<TPayload = void>(
    overrides: Partial<TaskConfig<string, TPayload>> & { execute: TaskConfig<string, TPayload>["execute"] },
): Task<string, TPayload> {
    const task = createTask(overrides);
    task.enable(mockCtx());
    return task;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createTask validation", () => {
    it("throws when id is empty string", () => {
        expect(() => createTaskHelper({ id: "", execute: async () => {} })).toThrow("createTask: id is required");
    });

    it("throws when id is only whitespace", () => {
        expect(() => createTaskHelper({ id: "   ", execute: async () => {} })).toThrow("createTask: id is required");
    });
});

describe("Task", () => {
    // ── 1. Construction & identity ────────────────────────────────────

    describe("constructor", () => {
        it("initial status is Registered", () => {
            const task = createTask({ execute: async () => {} });
            expect(task.status().state).toBe(TaskStatus.Registered);
        });

        it("id returns config.id", () => {
            const task = createTask({ id: "my-task", execute: async () => {} });
            expect(task.id).toBe("my-task");
        });
    });

    // ── 2. enable / disable ──────────────────────────────────────────

    describe("enable", () => {
        it("transitions status to Scheduled", () => {
            const task = createTask({ autoStart: false, execute: async () => {} });
            task.enable(mockCtx());
            expect(task.status().state).toBe(TaskStatus.Scheduled);
        });

        it("is idempotent — second call is a no-op", () => {
            const task = createTask({ autoStart: false, execute: async () => {} });
            task.enable(mockCtx());
            task.enable(mockCtx());
            expect(task.status().state).toBe(TaskStatus.Scheduled);
        });

        it("autoStart defaults to true — triggers execution without cron", async () => {
            let ran = false;
            createEnabled({
                execute: async () => {
                    ran = true;
                },
            });
            await delay(10);
            expect(ran).toBe(true);
        });

        it("autoStart=false does not trigger execution", async () => {
            let ran = false;
            createEnabled({
                autoStart: false,
                execute: async () => {
                    ran = true;
                },
            });
            await delay(10);
            expect(ran).toBe(false);
        });
    });

    describe("disable", () => {
        it("sets status to Stopped when not running", () => {
            const task = createEnabled({ autoStart: false, execute: async () => {} });
            task.disable();
            expect(task.status().state).toBe(TaskStatus.Stopped);
        });

        it("graceful mode lets running task finish", async () => {
            const b = blocker();
            let completed = false;
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    await b.promise;
                    completed = true;
                },
            });
            const p = task.start();
            await delay(5);
            task.disable("graceful");
            b.resolve();
            await p;
            expect(completed).toBe(true);
        });

        it("force mode aborts running task via signal", async () => {
            const b = blocker();
            let aborted = false;
            const task = createEnabled({
                autoStart: false,
                execute: async (_ctx, _p, execCtx) => {
                    execCtx.signal.addEventListener("abort", () => {
                        aborted = true;
                    });
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            task.disable("force");
            expect(aborted).toBe(true);
            b.resolve();
            await p;
        });

        it("clears queued payload on disable", async () => {
            const b = blocker();
            const task = createEnabled({
                autoStart: false,
                overlap: TaskOverlapStrategy.Queue,
                execute: async () => {
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            void task.start();
            expect(task.status().queueSize).toBeGreaterThan(0);
            task.disable();
            expect(task.status().queueSize).toBe(0);
            b.resolve();
            await p;
        });

        it("status becomes Stopped after running task completes post-disable", async () => {
            const b = blocker();
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            task.disable("graceful");
            b.resolve();
            await p;
            expect(task.status().state).toBe(TaskStatus.Stopped);
        });
    });

    // ── 3. start ──────────────────────────────────────────────────────

    describe("start", () => {
        it("executes the task function", async () => {
            let ran = false;
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    ran = true;
                },
            });
            await task.start();
            expect(ran).toBe(true);
        });

        it("passes payload to execute", async () => {
            let received: unknown;
            const task = createEnabled<{ key: string }>({
                autoStart: false,
                execute: async (_ctx, payload) => {
                    received = payload;
                },
            });
            await task.start({ key: "value" });
            expect(received).toEqual({ key: "value" });
        });

        it("provides TaskExecutionContext with signal and attempt", async () => {
            let captured: TaskExecutionContext | undefined;
            const task = createEnabled({
                autoStart: false,
                execute: async (_c, _p, execCtx) => {
                    captured = execCtx;
                },
            });
            await task.start();
            expect(captured).toBeDefined();
            expect(captured?.attempt).toBe(1);
            expect(captured?.signal).toBeInstanceOf(AbortSignal);
        });

        it("is a no-op when task is not enabled", async () => {
            let ran = false;
            const task = createTask({
                autoStart: false,
                execute: async () => {
                    ran = true;
                },
            });
            await task.start();
            expect(ran).toBe(false);
        });

        it("rejects when execute throws", async () => {
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    throw new Error("boom");
                },
            });
            await expect(task.start()).rejects.toThrow("boom");
        });
    });

    // ── 4. status ────────────────────────────────────────────────────

    describe("status", () => {
        it("returns full TaskStatusInfo shape for a fresh task", () => {
            const task = createTask({ id: "s1", execute: async () => {} });
            expect(task.status()).toEqual({
                taskId: "s1",
                state: TaskStatus.Registered,
                running: false,
                queueSize: 0,
                lastRunAt: null,
                lastSuccessAt: null,
                lastErrorAt: null,
                lastError: null,
            });
        });

        it("running is true during execution", async () => {
            const b = blocker();
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            expect(task.status().running).toBe(true);
            b.resolve();
            await p;
            expect(task.status().running).toBe(false);
        });

        it("tracks lastRunAt on execution", async () => {
            const task = createEnabled({ autoStart: false, execute: async () => {} });
            await task.start();
            expect(task.status().lastRunAt).toBeGreaterThan(0);
        });

        it("tracks lastSuccessAt and clears lastError after success", async () => {
            const task = createEnabled({ autoStart: false, execute: async () => {} });
            await task.start();
            const s = task.status();
            expect(s.lastSuccessAt).toBeGreaterThan(0);
            expect(s.lastError).toBeNull();
        });

        it("tracks lastErrorAt and lastError after failure", async () => {
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    throw new Error("fail");
                },
            });
            await task.start().catch(() => {});
            const s = task.status();
            expect(s.lastErrorAt).toBeGreaterThan(0);
            expect(s.lastError).toBeInstanceOf(Error);
            expect(s.lastError?.message).toBe("fail");
        });
    });

    // ── 5. State machine transitions ─────────────────────────────────

    describe("State machine", () => {
        it("Registered → Scheduled on enable", () => {
            const task = createTask({ autoStart: false, execute: async () => {} });
            expect(task.status().state).toBe(TaskStatus.Registered);
            task.enable(mockCtx());
            expect(task.status().state).toBe(TaskStatus.Scheduled);
        });

        it("Scheduled → Running → Scheduled on successful execution", async () => {
            const b = blocker();
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            expect(task.status().state).toBe(TaskStatus.Running);
            b.resolve();
            await p;
            expect(task.status().state).toBe(TaskStatus.Scheduled);
        });

        it("Running → Failed after all retries exhausted", async () => {
            const task = createEnabled({
                autoStart: false,
                retry: { attempts: 2, strategy: TaskRetryStrategy.Fixed, delayMs: 5 },
                execute: async () => {
                    throw new Error("fail");
                },
            });
            await task.start().catch(() => {});
            expect(task.status().state).toBe(TaskStatus.Failed);
        });

        it("Running → Stopped when disabled during execution", async () => {
            const b = blocker();
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            task.disable();
            b.resolve();
            await p;
            expect(task.status().state).toBe(TaskStatus.Stopped);
        });

        it("Failed → Scheduled on successful re-run", async () => {
            let shouldFail = true;
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    if (shouldFail) throw new Error("fail");
                },
            });
            await task.start().catch(() => {});
            expect(task.status().state).toBe(TaskStatus.Failed);

            shouldFail = false;
            await task.start();
            expect(task.status().state).toBe(TaskStatus.Scheduled);
        });
    });

    // ── 6. Overlap strategies ────────────────────────────────────────

    describe("Overlap: Skip (default)", () => {
        it("silently ignores concurrent call when running", async () => {
            const b = blocker();
            let runCount = 0;
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    runCount++;
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            await task.start();
            b.resolve();
            await p;
            expect(runCount).toBe(1);
        });
    });

    describe("Overlap: Queue", () => {
        it("queues execution instead of skipping", async () => {
            const b = blocker();
            const task = createEnabled({
                autoStart: false,
                overlap: TaskOverlapStrategy.Queue,
                execute: async () => {
                    await b.promise;
                },
            });
            const p = task.start();
            await delay(5);
            void task.start();
            expect(task.status().queueSize).toBeGreaterThan(0);
            b.resolve();
            await p;
        });

        it("processes queued payloads in FIFO order", async () => {
            const b = blocker();
            const payloads: string[] = [];
            const task = createEnabled<string>({
                autoStart: false,
                overlap: TaskOverlapStrategy.Queue,
                execute: async (_ctx, payload) => {
                    if (payloads.length === 0) await b.promise;
                    payloads.push(payload);
                },
            });
            const p = task.start("first");
            await delay(5);
            void task.start("a");
            void task.start("b");
            void task.start("latest");
            expect(task.status().queueSize).toBe(3);
            b.resolve();
            await p;
            await delay(50);
            expect(payloads).toEqual(["first", "a", "b", "latest"]);
        });

        it("discards queue on failure", async () => {
            let runCount = 0;
            const task = createEnabled({
                autoStart: false,
                overlap: TaskOverlapStrategy.Queue,
                execute: async () => {
                    runCount++;
                    if (runCount === 1) {
                        await delay(5);
                        throw new Error("fail");
                    }
                },
            });
            const p = task.start();
            await delay(2);
            void task.start();
            await p.catch(() => {});
            await delay(20);
            expect(runCount).toBe(1);
        });
    });

    describe("Overlap: Parallel", () => {
        it("allows concurrent runs", async () => {
            const b = blocker();
            let peakConcurrency = 0;
            let concurrent = 0;
            const task = createEnabled({
                autoStart: false,
                overlap: TaskOverlapStrategy.Parallel,
                execute: async () => {
                    concurrent++;
                    peakConcurrency = Math.max(peakConcurrency, concurrent);
                    await b.promise;
                    concurrent--;
                },
            });
            const p1 = task.start();
            const p2 = task.start();
            const p3 = task.start();
            await delay(5);
            expect(peakConcurrency).toBe(3);
            b.resolve();
            await Promise.all([p1, p2, p3]);
        });
    });

    // ── 7. Deduplication ─────────────────────────────────────────────

    describe("Dedupe", () => {
        it("prevents duplicate concurrent run with same dedupeKey", async () => {
            const b = blocker();
            let runCount = 0;
            const task = createEnabled<string>({
                autoStart: false,
                overlap: TaskOverlapStrategy.Parallel,
                dedupeKey: (p) => p ?? "default",
                execute: async () => {
                    runCount++;
                    await b.promise;
                },
            });
            const p1 = task.start("key-a");
            await delay(5);
            await task.start("key-a");
            b.resolve();
            await p1;
            expect(runCount).toBe(1);
        });

        it("allows run after dedupe key released", async () => {
            let runCount = 0;
            const task = createEnabled<string>({
                autoStart: false,
                overlap: TaskOverlapStrategy.Parallel,
                dedupeKey: (p) => p ?? "default",
                execute: async () => {
                    runCount++;
                },
            });
            await task.start("key-b");
            await task.start("key-b");
            expect(runCount).toBe(2);
        });

        it("different dedupe keys run concurrently", async () => {
            const b = blocker();
            let peakConcurrent = 0;
            let concurrent = 0;
            const task = createEnabled<string>({
                autoStart: false,
                overlap: TaskOverlapStrategy.Parallel,
                dedupeKey: (p) => p ?? "default",
                execute: async () => {
                    concurrent++;
                    peakConcurrent = Math.max(peakConcurrent, concurrent);
                    await b.promise;
                    concurrent--;
                },
            });
            const p1 = task.start("key-x");
            const p2 = task.start("key-y");
            await delay(5);
            expect(peakConcurrent).toBe(2);
            b.resolve();
            await Promise.all([p1, p2]);
        });
    });

    // ── 8. Retry ─────────────────────────────────────────────────────

    describe("Retry", () => {
        it("no retry config — single attempt", async () => {
            let attempts = 0;
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    attempts++;
                    throw new Error("fail");
                },
            });
            await task.start().catch(() => {});
            expect(attempts).toBe(1);
        });

        it("fixed strategy retries with constant delay", async () => {
            let attempts = 0;
            const timestamps: number[] = [];
            const task = createEnabled({
                autoStart: false,
                retry: { attempts: 3, strategy: TaskRetryStrategy.Fixed, delayMs: 20 },
                execute: async () => {
                    timestamps.push(Date.now());
                    attempts++;
                    throw new Error("fail");
                },
            });
            await task.start().catch(() => {});
            expect(attempts).toBe(3);
            expect(timestamps).toHaveLength(3);

            const gap1 = timestamps[1]! - timestamps[0]!;
            const gap2 = timestamps[2]! - timestamps[1]!;
            expect(gap1).toBeGreaterThanOrEqual(15);
            expect(gap2).toBeGreaterThanOrEqual(15);
            expect(Math.abs(gap2 - gap1)).toBeLessThan(30);
        });

        it("exponential strategy uses increasing delays", async () => {
            let attempts = 0;
            const timestamps: number[] = [];
            const task = createEnabled({
                autoStart: false,
                retry: { attempts: 4, strategy: TaskRetryStrategy.Exponential, delayMs: 10 },
                execute: async () => {
                    timestamps.push(Date.now());
                    attempts++;
                    throw new Error("fail");
                },
            });
            await task.start().catch(() => {});
            expect(attempts).toBe(4);
            expect(timestamps).toHaveLength(4);

            const gap1 = timestamps[1]! - timestamps[0]!;
            const gap2 = timestamps[2]! - timestamps[1]!;
            const gap3 = timestamps[3]! - timestamps[2]!;
            expect(gap2).toBeGreaterThan(gap1 * 1.5);
            expect(gap3).toBeGreaterThan(gap2 * 1.5);
        });

        it("stops retrying after first success", async () => {
            let attempts = 0;
            const task = createEnabled({
                autoStart: false,
                retry: { attempts: 5, strategy: TaskRetryStrategy.Fixed, delayMs: 5 },
                execute: async () => {
                    attempts++;
                    if (attempts < 3) throw new Error("transient");
                },
            });
            await task.start();
            expect(attempts).toBe(3);
        });

        it("aborts retry loop when disabled between attempts", async () => {
            let attempts = 0;
            const task = createEnabled({
                autoStart: false,
                retry: { attempts: 5, strategy: TaskRetryStrategy.Fixed, delayMs: 20 },
                execute: async () => {
                    attempts++;
                    throw new Error("fail");
                },
            });
            const p = task.start().catch(() => {});
            await delay(30);
            task.disable("force");
            await p;
            expect(attempts).toBeLessThan(5);
        });

        it("wraps non-Error thrown values in Error", async () => {
            const task = createEnabled({
                autoStart: false,
                execute: async () => {
                    throw "string-rejection";
                },
            });
            await expect(task.start()).rejects.toThrow("string-rejection");
            expect(task.status().lastError).toBeInstanceOf(Error);
        });
    });

    // ── 9. Timeout ───────────────────────────────────────────────────

    describe("Timeout", () => {
        it("rejects with descriptive message when execution exceeds timeoutMs", async () => {
            const task = createEnabled({
                autoStart: false,
                timeoutMs: 30,
                execute: async () => {
                    await delay(500);
                },
            });
            await expect(task.start()).rejects.toThrow(/timed out after 30ms/);
        });

        it("fires abort signal on timeout", async () => {
            let captured: TaskExecutionContext | undefined;
            const task = createEnabled({
                autoStart: false,
                timeoutMs: 30,
                execute: async (_ctx, _p, execCtx) => {
                    captured = execCtx;
                    await delay(500);
                },
            });
            await task.start().catch(() => {});
            expect(captured).toBeDefined();
            expect(captured?.signal.aborted).toBe(true);
        });

        it("sets status to Failed after timeout", async () => {
            const task = createEnabled({
                autoStart: false,
                timeoutMs: 30,
                execute: async () => {
                    await delay(500);
                },
            });
            await task.start().catch(() => {});
            expect(task.status().state).toBe(TaskStatus.Failed);
        });

        it("re-throws non-timeout errors even with timeoutMs set", async () => {
            const task = createEnabled({
                autoStart: false,
                timeoutMs: 5000,
                execute: async () => {
                    throw new Error("sync-fail");
                },
            });
            await expect(task.start()).rejects.toThrow("sync-fail");
        });

        it("timeoutMs=0 is treated as no timeout", async () => {
            let completed = false;
            const task = createEnabled({
                autoStart: false,
                timeoutMs: 0,
                execute: async () => {
                    await delay(30);
                    completed = true;
                },
            });
            await task.start();
            expect(completed).toBe(true);
        });
    });

    // ── 10. Cron scheduling ──────────────────────────────────────────

    describe("Cron", () => {
        it("autoStart + cron schedules periodic execution", async () => {
            let runCount = 0;
            const task = createEnabled({
                cron: "* * * * * *",
                execute: async () => {
                    runCount++;
                },
            });
            await delay(2500);
            task.disable();
            expect(runCount).toBeGreaterThanOrEqual(1);
        });

        it("autoStart=false with cron does not schedule", async () => {
            let runCount = 0;
            const task = createEnabled({
                cron: "* * * * * *",
                autoStart: false,
                execute: async () => {
                    runCount++;
                },
            });
            await delay(1500);
            task.disable();
            expect(runCount).toBe(0);
        });

        it("disable stops cron from firing", async () => {
            let runCount = 0;
            const task = createEnabled({
                cron: "* * * * * *",
                execute: async () => {
                    runCount++;
                },
            });
            await delay(1500);
            task.disable();
            const countAtStop = runCount;
            await delay(2000);
            expect(runCount).toBe(countAtStop);
        });
    });

    // ── 11. FIFO queue ───────────────────────────────────────────────

    describe("FIFO queue", () => {
        it("queue() pushes payload and processes sequentially", async () => {
            const results: number[] = [];
            const task = createEnabled<number>({
                autoStart: false,
                execute: async (_ctx, payload) => {
                    await delay(5);
                    results.push(payload);
                },
            });
            task.queue(1);
            task.queue(2);
            task.queue(3);
            await delay(100);
            expect(results).toEqual([1, 2, 3]);
        });

        it("queue() is no-op when not enabled", () => {
            const task = createTask<number>({
                autoStart: false,
                execute: async () => {},
            });
            task.queue(1);
            expect(task.status().queueSize).toBe(0);
        });

        it("clear() removes all queued payloads", async () => {
            const b = blocker();
            const task = createEnabled<number>({
                autoStart: false,
                execute: async () => {
                    await b.promise;
                },
            });
            task.queue(1);
            task.queue(2);
            task.queue(3);
            await delay(5);
            expect(task.status().queueSize).toBe(2);
            task.clear();
            expect(task.status().queueSize).toBe(0);
            b.resolve();
            await delay(20);
        });

        it("stop() aborts current but queue continues", async () => {
            const results: number[] = [];
            const task = createEnabled<number>({
                autoStart: false,
                execute: async (_ctx, payload, execCtx) => {
                    if (payload === 1) {
                        await new Promise((_, reject) => {
                            execCtx.signal.addEventListener("abort", () => reject(new Error("aborted")));
                        });
                    }
                    results.push(payload);
                },
            });
            task.queue(1);
            task.queue(2);
            await delay(5);
            task.stop();
            await delay(50);
            expect(results).toContain(2);
            expect(results).not.toContain(1);
        });

        it("stop() when task handles abort gracefully does not leak _stopping flag", async () => {
            const results: number[] = [];
            let callCount = 0;
            const task = createEnabled<number>({
                autoStart: false,
                execute: async (_ctx, payload, execCtx) => {
                    callCount++;
                    if (callCount === 1) {
                        // Task catches abort internally and completes successfully
                        try {
                            await new Promise((_, reject) => {
                                execCtx.signal.addEventListener("abort", () => reject(new Error("aborted")));
                            });
                        } catch {
                            // swallow abort — task "succeeds"
                        }
                        return;
                    }
                    // Second execution fails — should clear queue (not drain it)
                    if (callCount === 2) {
                        throw new Error("real failure");
                    }
                    results.push(payload);
                },
            });
            // First: queue item, then stop() — task catches abort, completes without error
            task.queue(1);
            await delay(5);
            task.stop();
            await delay(20);
            // Second: start fresh — if it fails, queue should be cleared (not drained)
            task.queue(10);
            task.queue(20);
            await delay(50);
            // payload 10 triggers failure → queue should clear, 20 should NOT process
            expect(results).not.toContain(20);
        });

        it("disable() clears queue", async () => {
            const b = blocker();
            const task = createEnabled<number>({
                autoStart: false,
                execute: async () => {
                    await b.promise;
                },
            });
            task.queue(1);
            task.queue(2);
            await delay(5);
            task.disable();
            expect(task.status().queueSize).toBe(0);
            b.resolve();
        });
    });
});
