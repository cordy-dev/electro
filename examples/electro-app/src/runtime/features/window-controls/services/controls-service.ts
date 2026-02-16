/**
 * Window controls feature — demonstrates exposed services for IPC.
 *
 * The "controls" service (EXPOSED scope) provides window management
 * methods that the renderer can call via the generated IPC bridge.
 */
import { createService, ServiceScope } from "@cordy/electro";

export const controlsService = createService({
    id: "controls",
    scope: ServiceScope.EXPOSED,
    api: (ctx) => ({
        minimize() {
            console.log("[window-controls] minimize called");
        },
        maximize() {
            console.log("[window-controls] maximize called");
        },
        isMaximized() {
            console.log("[window-controls] isMaximized called");
            return false;
        },
        setTitle(title: string) {
            console.log(`[window-controls] setTitle: ${title}`);
        },
    }),
});
