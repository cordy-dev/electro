import { Cron } from "croner";
import { delay, TimeoutError, withTimeout } from "es-toolkit";
import type { FeatureContext } from "../feature/types";
import { TaskOverlapStrategy, TaskRetryStrategy, TaskStatus, TaskTriggerKind } from "./enums";
import type { StopMode, TaskConfig, TaskExecutionContext, TaskId, TaskStatusInfo } from "./types";

const noop = () => {};

/**
 * Single executable unit within the Electro task system.
 *
 * Supports overlap strategies (skip / queue / parallel), per-payload deduplication,
 * configurable retry with fixed or exponential backoff, timeouts with abort propagation,
 * and cron-based scheduling via `croner`.
 *
 * State machine: `Registered → Scheduled → Running → Scheduled | Failed | Stopped`
 */
export class Task<TId extends TaskId, TPayload = void> {
    private _status: TaskStatus = TaskStatus.Registered;
    private _runningCount = 0;
    private _lastRunAt: number | null = null;
    private _lastSuccessAt: number | null = null;
    private _lastErrorAt: number | null = null;
    private _lastError: Error | null = null;
    private _queue: TPayload[] = [];
    private _stopping = false;
    private _enabled = false;
    private _abortControllers = new Set<AbortController>();
    private _cronJob: Cron | null = null;
    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    private _ctx: FeatureContext<any> | null = null;
    private _activeDedupeKeys = new Set<string>();

    constructor(private readonly config: TaskConfig<TId, TPayload>) {}

    get id(): TId {
        return this.config.id;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    /** Activate the task within a feature context. Idempotent. */
    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    enable(ctx: FeatureContext<any>): void {
        if (this._enabled) return;

        this._ctx = ctx;
        this._enabled = true;
        this._status = TaskStatus.Scheduled;

        const autoStart = this.config.autoStart !== false;

        if (this.config.cron && autoStart) {
            this.scheduleCron();
        } else if (!this.config.cron && autoStart) {
            this.execute(TaskTriggerKind.Manual, undefined).catch(noop);
        }
    }

    /** Deactivate the task. `"graceful"` lets running executions finish; `"force"` aborts them. */
    disable(mode: StopMode = "graceful"): void {
        this._enabled = false;
        this.clear();

        if (this._cronJob) {
            this._cronJob.stop();
            this._cronJob = null;
        }

        if (mode === "force") {
            for (const ac of this._abortControllers) {
                ac.abort();
            }
        }

        if (this._runningCount === 0) {
            this._status = TaskStatus.Stopped;
        }
    }

    // ── Execution ────────────────────────────────────────────────────────

    /** Trigger a manual execution. No-op when the task is not enabled. */
    async start(payload?: TPayload): Promise<void> {
        await this.execute(TaskTriggerKind.Manual, payload);
    }

    /** Push payload to FIFO queue. Starts processing if idle. */
    queue(payload: TPayload): void {
        if (!this._enabled || !this._ctx) return;
        if (this._runningCount > 0) {
            this._queue.push(payload);
            return;
        }
        this.execute(TaskTriggerKind.Manual, payload).catch(noop);
    }

    /** Abort current execution. Queue continues processing next item. */
    stop(): void {
        this._stopping = true;
        for (const ac of this._abortControllers) {
            ac.abort();
        }
    }

    /** Clear the FIFO queue without stopping current execution. */
    clear(): void {
        this._queue = [];
    }

    // ── Status ───────────────────────────────────────────────────────────

    /** Snapshot of the task's current state and run history. */
    status(): TaskStatusInfo {
        return {
            taskId: this.id,
            state: this._status,
            running: this._runningCount > 0,
            queueSize: this._queue.length,
            lastRunAt: this._lastRunAt,
            lastSuccessAt: this._lastSuccessAt,
            lastErrorAt: this._lastErrorAt,
            lastError: this._lastError,
        };
    }

    // ── Private: Execution pipeline ─────────────────────────────────────

    private async execute(trigger: TaskTriggerKind, payload: TPayload | undefined): Promise<void> {
        if (!this._enabled || !this._ctx) return;
        const ctx = this._ctx;
        this._stopping = false;

        if (this.shouldSkipExecution(payload)) return;

        const dedupeKey = this.acquireDedupeKey(payload);
        this._runningCount++;
        this._status = TaskStatus.Running;

        let lastError: Error | null = null;

        try {
            lastError = await this.executeWithRetry(ctx, payload);
        } finally {
            this._runningCount--;
            if (dedupeKey) this._activeDedupeKeys.delete(dedupeKey);
            this.resolveStatus(lastError);
        }

        if (lastError) {
            if (this._stopping) {
                this._stopping = false;
                this.drainQueue(trigger);
            } else {
                this._queue = [];
                throw lastError;
            }
            return;
        }

        this.drainQueue(trigger);
    }

    private resolveStatus(lastError: Error | null): void {
        if (this._runningCount > 0) return;

        if (lastError) {
            this._status = TaskStatus.Failed;
        } else if (this._enabled) {
            this._status = TaskStatus.Scheduled;
        } else {
            this._status = TaskStatus.Stopped;
        }
    }

    // ── Private: Overlap & Dedupe ───────────────────────────────────────

    private shouldSkipExecution(payload: TPayload | undefined): boolean {
        if (this._runningCount === 0) return false;

        const overlap = this.config.overlap ?? TaskOverlapStrategy.Skip;

        if (overlap === TaskOverlapStrategy.Skip) return true;

        if (overlap === TaskOverlapStrategy.Queue) {
            this._queue.push(payload as TPayload);
            return true;
        }

        if (this.config.dedupeKey) {
            return this._activeDedupeKeys.has(this.config.dedupeKey(payload as TPayload));
        }

        return false;
    }

    private acquireDedupeKey(payload: TPayload | undefined): string | undefined {
        if (!this.config.dedupeKey) return undefined;
        const key = this.config.dedupeKey(payload as TPayload);
        this._activeDedupeKeys.add(key);
        return key;
    }

    // ── Private: Retry loop ─────────────────────────────────────────────

    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    private async executeWithRetry(ctx: FeatureContext<any>, payload: TPayload | undefined): Promise<Error | null> {
        const retryConfig = this.config.retry;
        const maxAttempts = retryConfig ? retryConfig.attempts : 1;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (!this._enabled) break;

            const ac = new AbortController();
            this._abortControllers.add(ac);
            this._lastRunAt = Date.now();

            try {
                const execCtx: TaskExecutionContext = { signal: ac.signal, attempt };
                const promise = Promise.resolve(this.config.execute(ctx, payload as TPayload, execCtx));

                if (this.config.timeoutMs && this.config.timeoutMs > 0) {
                    await this.executeWithTimeout(promise, this.config.timeoutMs, ac);
                } else {
                    await promise;
                }

                this._lastSuccessAt = Date.now();
                this._lastError = null;
                return null;
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                lastError = error;
                this._lastErrorAt = Date.now();
                this._lastError = error;

                if (attempt < maxAttempts && retryConfig) {
                    await delay(this.computeRetryDelay(retryConfig.strategy, retryConfig.delayMs, attempt));
                }
            } finally {
                this._abortControllers.delete(ac);
            }
        }

        return lastError;
    }

    // ── Private: Queue ──────────────────────────────────────────────────

    private drainQueue(trigger: TaskTriggerKind): void {
        if (this._queue.length === 0 || !this._enabled) return;
        const payload = this._queue.shift();
        this.execute(trigger, payload).catch(noop);
    }

    // ── Private: Cron ───────────────────────────────────────────────────

    private scheduleCron(): void {
        this._cronJob = new Cron(this.config.cron!, () => {
            this.execute(TaskTriggerKind.Cron, undefined).catch(noop);
        });
    }

    // ── Private: Timeout ────────────────────────────────────────────────

    private async executeWithTimeout(promise: Promise<void>, timeoutMs: number, ac: AbortController): Promise<void> {
        try {
            await withTimeout(() => promise, timeoutMs);
        } catch (err) {
            if (err instanceof TimeoutError) {
                ac.abort();
                throw new Error(`Task "${this.id}" timed out after ${timeoutMs}ms`);
            }
            throw err;
        }
    }

    // ── Private: Helpers ────────────────────────────────────────────────

    private computeRetryDelay(strategy: TaskRetryStrategy, baseMs: number, attempt: number): number {
        if (strategy === TaskRetryStrategy.Exponential) {
            return baseMs * 2 ** (attempt - 1);
        }
        return baseMs;
    }
}
