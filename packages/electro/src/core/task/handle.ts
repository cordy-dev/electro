import type { FeatureContext } from "../feature/types";
import type { StopMode, TaskInstance, TaskStatusInfo } from "./types";

/**
 * Ergonomic handle for a single {@link Task}.
 *
 * Provides per-task control: start, queue, stop, enable, disable, clear, status.
 * Created by Feature and bound to `ctx.getTask(name)`.
 */
export class TaskHandle<TPayload = unknown> {
    constructor(
        private readonly task: TaskInstance,
        // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
        private readonly ctx: FeatureContext<any> | undefined = undefined,
    ) {}

    /** Execute immediately (respects overlap policy). */
    async start(payload?: TPayload): Promise<void> {
        await this.task.start(payload);
    }

    /** Push payload to FIFO queue, processes sequentially. */
    queue(payload: TPayload): void {
        this.task.queue(payload);
    }

    /** Abort current execution. Queue continues processing. */
    stop(): void {
        this.task.stop();
    }

    /** Re-enable the task (cron, ready for start/queue). */
    enable(): void {
        if (this.ctx) {
            this.task.enable(this.ctx);
        }
    }

    /** Abort current + clear queue + stop cron. */
    disable(mode?: StopMode): void {
        this.task.disable(mode);
    }

    /** Clear the FIFO queue without stopping current execution. */
    clear(): void {
        this.task.clear();
    }

    /** Snapshot of the task's current state. */
    status(): TaskStatusInfo {
        return this.task.status();
    }
}
