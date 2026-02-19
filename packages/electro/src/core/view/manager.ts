import type { ViewId, ViewInstance } from "./types";

/**
 * ViewManager — global registry for view instances.
 *
 * Views are registered at runtime startup and accessible from any feature.
 * Views are idempotent: `get(id).create()` returns the same instance if alive.
 */
export class ViewManager {
    private readonly instances = new Map<ViewId, ViewInstance>();

    register(view: ViewInstance): void {
        if (this.instances.has(view.id)) {
            throw new Error(`View "${view.id}" is already registered`);
        }
        this.instances.set(view.id, view);
    }

    get(id: ViewId): ViewInstance | null {
        return this.instances.get(id) ?? null;
    }

    destroyAll(): void {
        for (const inst of this.instances.values()) {
            inst.destroy();
        }
    }
}
