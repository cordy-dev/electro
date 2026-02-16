import { createTask, TaskOverlapStrategy } from "@cordy/electro";

export const dataSyncTask = createTask({
    id: "data-sync",
    autoStart: false,
    overlap: TaskOverlapStrategy.Queue,
    execute: async (ctx, payload: { table: string; ids: number[] }) => {
        ctx.logger.debug("sync", `Syncing ${payload.table}: ${payload.ids.length} items`);
        // Simulate API call
        await new Promise((r) => setTimeout(r, 50));
        ctx.logger.debug("sync", `Synced ${payload.table} successfully`);
    },
});
