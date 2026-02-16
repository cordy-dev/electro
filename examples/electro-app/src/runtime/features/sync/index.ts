import { createFeature } from "@cordy/electro";
import { dataSyncTask } from "./tasks/data-sync";
import { healthCheckTask } from "./tasks/health-check";
import { unreliableApiTask } from "./tasks/unreliable-api";

export const syncFeature = createFeature({
    id: "sync",
    dependencies: ["app-core", "window-controls", "settings"],
    tasks: [dataSyncTask, healthCheckTask, unreliableApiTask],

    onInitialize(ctx) {
        ctx.logger.debug("sync", "Sync feature initializing");

        ctx.getService("window-controls:controls");

        // Access settings from another feature (only exposed + internal scopes visible)
        // const settings = ctx.getService("settings:settings") as { exposed: SettingsPublicApi };

        // Capture task handles for later use
        const dataSync = ctx.getTask("data-sync");
        const unreliable = ctx.getTask("unreliable-api");

        // Subscribe to settings changes to trigger sync
        ctx.events.on("settings:loaded", () => {
            ctx.logger.debug("sync", "Settings loaded, queueing initial sync");
            dataSync.queue({ table: "users", ids: [1, 2, 3] });
            dataSync.queue({ table: "preferences", ids: [1] });
        });

        // Store handle for demo access
        (globalThis as Record<string, unknown>).__syncHandles = {
            dataSync,
            unreliable,
        };
    },

    onActivate(ctx) {
        ctx.logger.debug("sync", "Sync activated — health checks started");
    },

    onDeactivate(ctx) {
        ctx.logger.debug("sync", "Sync deactivated — health checks stopped");
    },
});
