import type { ElectroWindow } from "./types";
import type { WindowManager } from "./manager";

/**
 * Thin accessor bound to FeatureContext.
 *
 * Provides `createWindow(name)` and `getWindow(name)` for features.
 * Delegates all work to WindowManager.
 */
export class WindowAccessor {
    constructor(private readonly manager: WindowManager) {}

    createWindow(name: string): ElectroWindow {
        return this.manager.createWindow(name);
    }

    getWindow(name: string): ElectroWindow | null {
        return this.manager.getWindow(name);
    }
}
