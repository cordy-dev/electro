import { delay } from "es-toolkit";
import { describe, expect, it, vi } from "vitest";
import type { EventAccessor } from "../event-bus/accessor";
import type { FeatureContext } from "../feature/types";
import { TaskStatus } from "./enums";
import { TaskHandle } from "./handle";
import { Task } from "./task";
import type { TaskConfig } from "./types";

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

function enabledTask<TPayload = void>(
    overrides: Partial<TaskConfig<string, TPayload>> & { execute: TaskConfig<string, TPayload>["execute"] },
): Task<string, TPayload> {
    const task = new Task({ id: overrides.id ?? "t", ...overrides });
    task.enable(mockCtx());
    return task;
}

describe("TaskHandle", () => {
    it("start() delegates to task.start()", async () => {
        let received: string | undefined;
        const task = enabledTask<string>({
            autoStart: false,
            execute: async (_c, p) => {
                received = p;
            },
        });
        const handle = new TaskHandle(task);
        await handle.start("hello");
        expect(received).toBe("hello");
    });

    it("queue() delegates to task.queue()", async () => {
        const results: number[] = [];
        const task = enabledTask<number>({
            autoStart: false,
            execute: async (_c, p) => {
                await delay(5);
                results.push(p);
            },
        });
        const handle = new TaskHandle(task);
        handle.queue(1);
        handle.queue(2);
        await delay(50);
        expect(results).toEqual([1, 2]);
    });

    it("stop() delegates to task.stop()", async () => {
        let aborted = false;
        const task = enabledTask({
            autoStart: false,
            execute: async (_c, _p, execCtx) => {
                aborted = await new Promise<boolean>((_, reject) => {
                    execCtx.signal.addEventListener("abort", () => reject(new Error("aborted")));
                }).catch(() => true);
            },
        });
        const handle = new TaskHandle(task);
        handle.start();
        await delay(5);
        handle.stop();
        await delay(10);
        expect(aborted).toBe(true);
    });

    it("enable() / disable() delegate to task lifecycle", () => {
        const ctx = mockCtx();
        const task = new Task({ id: "t", autoStart: false, execute: async () => {} });
        const handle = new TaskHandle(task, ctx);
        handle.enable();
        expect(task.status().state).toBe(TaskStatus.Scheduled);
        handle.disable();
        expect(task.status().state).toBe(TaskStatus.Stopped);
    });

    it("enable() is a no-op when handle has no ctx", () => {
        const task = new Task({ id: "t", autoStart: false, execute: async () => {} });
        const enableSpy = vi.spyOn(task, "enable");
        const handle = new TaskHandle(task);
        handle.enable();
        expect(enableSpy).not.toHaveBeenCalled();
        expect(task.status().state).toBe(TaskStatus.Registered);
    });

    it("clear() delegates to task.clear()", async () => {
        const task = enabledTask<number>({
            autoStart: false,
            execute: async () => {
                await delay(100);
            },
        });
        const handle = new TaskHandle(task);
        handle.queue(1);
        handle.queue(2);
        await delay(5);
        handle.clear();
        expect(handle.status().queueSize).toBe(0);
        task.disable("force");
    });

    it("status() delegates to task.status()", () => {
        const task = enabledTask({ autoStart: false, execute: async () => {} });
        const handle = new TaskHandle(task);
        const s = handle.status();
        expect(s.taskId).toBe("t");
        expect(s.state).toBe(TaskStatus.Scheduled);
    });
});
