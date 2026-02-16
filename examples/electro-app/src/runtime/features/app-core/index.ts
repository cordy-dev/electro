/**
 * Core feature — bootstraps the app, publishes "ready" event.
 *
 * Other features depend on this and subscribe to "app-core:ready".
 */
import { createFeature } from "@cordy/electro";
import { readyEvent } from "./events/ready";
import { app, BrowserWindow } from "electron"

export const appCoreFeature = createFeature({
    id: "app-core",
    critical: true,
    events: [readyEvent],

    async onInitialize(ctx) {
        ctx.logger.debug("app-core", "Core systems initializing");
    },

    async onActivate(ctx) {
        ctx.logger.debug("app-core", "Core activated, publishing ready event");

        const window = ctx.createWindow("main");
        await window.load();

        window.on('ready-to-show', () => {
            window?.show();
        });

        ctx.logger.debug("app-core", "activated")

        app.on('activate', async () => {
            // On macOS re-create window when dock icon clicked
            if (BrowserWindow.getAllWindows().length === 0) {
                const window = ctx.createWindow("main");
                await window.load();
            }
        });

        ctx.events.publish("ready", { version: "0.1.0", startedAt: Date.now() });
    },

    onDestroy(ctx) {
        ctx.logger.debug("app-core", "Core destroyed");
    },
});
