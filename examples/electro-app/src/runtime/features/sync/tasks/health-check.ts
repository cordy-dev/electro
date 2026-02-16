import { createTask, TaskOverlapStrategy } from "@cordy/electro";

export const healthCheckTask = createTask({
    id: "health-check",
    autoStart: true,
    cron: "*/30 * * * * *", // every 30 seconds
    overlap: TaskOverlapStrategy.Skip,
    execute: async (ctx) => {
        ctx.logger.debug("sync", "Health check: OK");
    },
});
