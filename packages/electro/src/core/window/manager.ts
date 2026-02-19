import type { WindowId, WindowInstance } from "./types";

/**
 * WindowManager — global registry for window instances.
 *
 * Windows are registered at runtime startup and accessible from any feature.
 */
export class WindowManager {
    private readonly instances = new Map<WindowId, WindowInstance>();

    register(window: WindowInstance): void {
        if (this.instances.has(window.id)) {
            throw new Error(`Window "${window.id}" is already registered`);
        }
        this.instances.set(window.id, window);
    }

    get(id: WindowId): WindowInstance | null {
        return this.instances.get(id) ?? null;
    }

    destroyAll(): void {
        for (const inst of this.instances.values()) {
            inst.destroy();
        }
    }
}
