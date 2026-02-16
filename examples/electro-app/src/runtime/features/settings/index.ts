/**
 * Settings feature — demonstrates services with different scopes.
 *
 * - "store" (PRIVATE): internal key-value storage, not accessible from other features
 * - "settings" (EXPOSED): public API for reading/writing settings via IPC
 * - "defaults" (INTERNAL): accessible from dependent features but not from renderer
 */
import { createFeature } from "@cordy/electro";
import { loadedEvent } from "./events/loaded";
import { defaultsService } from "./services/defaults";
import { settingsPublicService } from "./services/settings";
import { storeService } from "./services/store";

export const settingsFeature = createFeature({
    id: "settings",
    dependencies: ["app-core"],
    services: [storeService, settingsPublicService, defaultsService],
    events: [loadedEvent],

    onInitialize(ctx) {
        ctx.logger.debug("settings", "Settings initializing");

        // Access own services — all scopes visible
        const store = ctx.getService("store");
        const defaults = ctx.getService("defaults");

        // Apply defaults to store
        const defaultValues = defaults.getDefaults();
        for (const [key, value] of Object.entries(defaultValues)) {
            store.set(key, value);
        }

        ctx.logger.debug("settings", `Loaded ${Object.keys(defaultValues).length} default settings`);
    },

    onActivate(ctx) {
        // Listen for core ready event — typed: payload is { version: string; startedAt: number }
        ctx.events.on("app-core:ready", (payload) => {
            ctx.logger.debug("settings", `Core ready: v${payload.version}`);
        });

        ctx.events.publish("loaded", { count: 4 });
    },
});
