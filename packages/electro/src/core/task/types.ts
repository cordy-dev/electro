import type { FeatureContext } from "../feature/types";
import type { _TaskOwner } from "../types";
import type { TaskOverlapStrategy, TaskRetryStrategy, TaskStatus } from "./enums";

export type TaskId = string;

export type StopMode = "graceful" | "force";

export type TaskRetryConfig = {
    attempts: number;
    strategy: TaskRetryStrategy;
    delayMs: number;
};

export type TaskExecutionContext = {
    signal: AbortSignal;
    attempt: number;
};

export type TaskConfig<TId extends TaskId, TPayload = void> = {
    id: TId;
    cron?: string;
    autoStart?: boolean;
    overlap?: TaskOverlapStrategy;
    dedupeKey?: (payload: TPayload) => string;
    timeoutMs?: number;
    retry?: TaskRetryConfig;
    execute: (
        ctx: FeatureContext<_TaskOwner<TId>, never, TId>,
        payload: TPayload,
        execCtx: TaskExecutionContext,
    ) => void | Promise<void>;
};

/**
 * Type-erased task interface for heterogeneous collections.
 *
 * Using a non-generic interface (instead of `Task<TaskId, unknown>`)
 * avoids TypeScript variance issues: `TaskConfig.execute` has `payload: TPayload`
 * in a contravariant position, making `Task` invariant in `TPayload`.
 * Interface methods are bivariant, so any `Task<TId, TPayload>` is
 * structurally assignable to `TaskInstance`.
 */
export interface TaskInstance {
    readonly id: TaskId;
    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    enable(ctx: FeatureContext<any>): void;
    disable(mode?: StopMode): void;
    start(payload?: unknown): Promise<void>;
    queue(payload: unknown): void;
    stop(): void;
    clear(): void;
    status(): TaskStatusInfo;
}

export interface TaskStatusInfo {
    taskId: string;
    state: TaskStatus;
    running: boolean;
    queueSize: number;
    lastRunAt: number | null;
    lastSuccessAt: number | null;
    lastErrorAt: number | null;
    lastError: Error | null;
}

/**
 * Public interface returned by {@link createTask}.
 *
 * Hides class internals (private fields) so consumers can safely
 * `export const myTask = createTask({...})` without TypeScript
 * "cannot be named" errors in declaration emit.
 *
 * Generic parameters preserve payload type for codegen inference
 * (`_TaskPayload<T>` infers `TPayload` from `start(payload?)`).
 */
export interface CreatedTask<TId extends TaskId = TaskId, TPayload = void> {
    readonly id: TId;
    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    enable(ctx: FeatureContext<any>): void;
    disable(mode?: StopMode): void;
    start(payload?: TPayload): Promise<void>;
    queue(payload: TPayload): void;
    stop(): void;
    clear(): void;
    status(): TaskStatusInfo;
}
