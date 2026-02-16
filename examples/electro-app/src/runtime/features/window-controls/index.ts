/**
 * Window controls feature — demonstrates exposed services for IPC.
 *
 * The "controls" service (EXPOSED scope) provides window management
 * methods that the renderer can call via the generated IPC bridge.
 */
import { createFeature } from "@cordy/electro";
import { controlsService } from "./services/controls-service";

export const windowControlsFeature = createFeature({
    id: "window-controls",
    dependencies: ["app-core", "settings"],
    services: [controlsService],
    async  onActivate(ctx) {





        ctx.logger.debug("window-controls", "Window controls ready");
    },
});
