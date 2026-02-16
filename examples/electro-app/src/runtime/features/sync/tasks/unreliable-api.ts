import { createTask, TaskRetryStrategy } from "@cordy/electro";

export const unreliableApiTask = createTask({
    id: "unreliable-api",
    autoStart: false,
    timeoutMs: 10_000,
    retry: {
        attempts: 3,
        strategy: TaskRetryStrategy.Exponential,
        delayMs: 100,
    },
    execute: async (ctx, _payload, execCtx) => {
        ctx.logger.debug("sync", `API call attempt #${execCtx.attempt}`);
        if (execCtx.attempt < 3) {
            throw new Error(`Connection timeout (attempt ${execCtx.attempt})`);
        }
        ctx.logger.debug("sync", "API call succeeded");
    },
});
