import type { FeatureContext } from "../feature/types";
import type { StopMode, TaskId, TaskInstance, TaskStatusInfo } from "./types";

/**
 * Registry and lifecycle coordinator for {@link Task} instances.
 *
 * Manages a flat collection of tasks: registration, bulk startup/shutdown,
 * individual enable/disable, manual execution, and status queries.
 *
 * Does **not** own scheduling or retry — those belong to {@link Task}.
 */
export class TaskManager {
    private tasks = new Map<TaskId, TaskInstance>();
    private _isShutdown = false;

    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    constructor(private readonly ctx: FeatureContext<any>) {}

    // ── Registration ─────────────────────────────────────────────────────

    /** Add a task to the registry. Throws on duplicate `task.id`. */
    register(task: TaskInstance): void {
        if (this.tasks.has(task.id)) {
            throw new Error(`Duplicate task id: "${task.id}"`);
        }
        this.tasks.set(task.id, task);
    }

    /** Remove a task, force-disabling it first. No-op for unknown ids. */
    unregister(taskId: TaskId): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.disable("force");
        this.tasks.delete(taskId);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    /** Enable all registered tasks. No-op after {@link shutdown}. */
    startup(): void {
        if (this._isShutdown) return;
        for (const task of this.tasks.values()) {
            task.enable(this.ctx);
        }
    }

    /** Disable all registered tasks. Marks the manager as shut down (startup becomes a no-op). */
    shutdown(mode: StopMode = "graceful"): void {
        this._isShutdown = true;
        for (const task of this.tasks.values()) {
            task.disable(mode);
        }
    }

    // ── Individual Task Control ──────────────────────────────────────────

    /** Enable a single task by id. Throws if the task is not registered. */
    enable(taskId: TaskId): void {
        this.getTaskInstance(taskId).enable(this.ctx);
    }

    /** Disable a single task by id. Throws if the task is not registered. */
    disable(taskId: TaskId, mode: StopMode = "graceful"): void {
        this.getTaskInstance(taskId).disable(mode);
    }

    /** Trigger a manual execution of the task. Throws if the task is not registered. */
    async start(taskId: TaskId, payload?: unknown): Promise<void> {
        await this.getTaskInstance(taskId).start(payload);
    }

    // ── Status / Listing ─────────────────────────────────────────────────

    /** Return the current status snapshot for a single task. */
    status(taskId: TaskId): TaskStatusInfo {
        return this.getTaskInstance(taskId).status();
    }

    /** Return status snapshots for all registered tasks. */
    list(): TaskStatusInfo[] {
        return Array.from(this.tasks.values()).map((t) => t.status());
    }

    // ── Public Accessor ──────────────────────────────────────────────────

    /** Return the raw Task instance. Throws if not registered. */
    getTaskInstance(taskId: TaskId): TaskInstance {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task "${taskId}" not found`);
        }
        return task;
    }
}
