import { join } from "node:path";
import type { WindowDefinition } from "../config/types";
import type { ElectroWindow, WindowFactory, WindowInfo } from "./types";

/**
 * WindowManager — registry, creation, and lifecycle coordinator for windows.
 *
 * Manages window definitions and their instances through a WindowFactory
 * abstraction. Enforces singleton/multi lifecycle semantics and provides
 * querying and bulk destruction capabilities.
 */
export class WindowManager {
    private readonly factory: WindowFactory;
    private readonly definitions = new Map<string, WindowDefinition>();
    private readonly instances = new Map<string, ElectroWindow[]>();

    constructor(factory: WindowFactory) {
        this.factory = factory;
    }

    // ── Definition registry ──────────────────────────────────────────

    /** Register a window definition. Throws on duplicate name. */
    registerDefinition(definition: WindowDefinition): void {
        if (this.definitions.has(definition.name)) {
            throw new Error(`Window definition duplicate: "${definition.name}" is already registered`);
        }
        this.definitions.set(definition.name, definition);
    }

    /** Check whether a definition is registered for the given name. */
    hasDefinition(name: string): boolean {
        return this.definitions.has(name);
    }

    // ── Window creation ──────────────────────────────────────────────

    /**
     * Create a window from a registered definition.
     *
     * - Throws if no definition exists for `name`.
     * - For singleton lifecycle (the default), throws if a live instance already exists.
     * - For multi lifecycle, always creates a new instance.
     */
    createWindow(name: string): ElectroWindow {
        const definition = this.definitions.get(name);
        if (!definition) {
            throw new Error(`Cannot create window: no definition found for "${name}"`);
        }

        const lifecycle = definition.lifecycle ?? "singleton";

        if (lifecycle === "singleton") {
            const existing = this.getAliveInstances(name);
            if (existing.length > 0) {
                throw new Error(`Cannot create window "${name}": singleton instance already exists`);
            }
        }

        const window = this.factory.create(definition);

        const electrified = window as ElectroWindow;
        electrified.load = async () => {
            if (typeof (window as any).loadURL !== "function") {
                throw new Error(
                    `Cannot load window "${name}": BaseWindow does not support loadURL/loadFile. ` +
                        `Set type: "browser-window" in your window definition.`,
                );
            }
            const bw = window as unknown as import("electron").BrowserWindow;
            const devUrl = process.env[`ELECTRO_DEV_URL_${name}`];
            if (devUrl) {
                await bw.loadURL(devUrl);
                return;
            }
            const { app } = await import("electron");
            await bw.loadFile(join(app.getAppPath(), ".electro", "out", "renderer", name, "index.html"));
        };

        const list = this.instances.get(name);
        if (list) {
            list.push(electrified);
        } else {
            this.instances.set(name, [electrified]);
        }

        return electrified;
    }

    // ── Window retrieval ─────────────────────────────────────────────

    /**
     * Get the first alive window for the given name, or null.
     * Cleans up destroyed instances as a side effect.
     */
    getWindow(name: string): ElectroWindow | null {
        const list = this.instances.get(name);
        if (!list) return null;

        // Filter out destroyed windows
        const alive = list.filter((w) => !w.isDestroyed());
        this.instances.set(name, alive);

        return alive.length > 0 ? alive[0] : null;
    }

    // ── Window destruction ───────────────────────────────────────────

    /** Destroy all instances for the given name. No-op if name is unknown. */
    destroyWindow(name: string): void {
        const list = this.instances.get(name);
        if (!list) return;

        for (const window of list) {
            if (!window.isDestroyed()) {
                window.destroy();
            }
        }

        this.instances.set(name, []);
    }

    /** Destroy all tracked windows across all names. */
    destroyAll(): void {
        for (const [name] of this.instances) {
            this.destroyWindow(name);
        }
    }

    // ── Query ────────────────────────────────────────────────────────

    /** Returns a snapshot of all tracked windows (including destroyed ones). */
    list(): WindowInfo[] {
        const result: WindowInfo[] = [];

        for (const [name, windows] of this.instances) {
            for (const window of windows) {
                result.push({
                    name,
                    windowId: window.id,
                    destroyed: window.isDestroyed(),
                });
            }
        }

        return result;
    }

    // ── Internal ─────────────────────────────────────────────────────

    /** Return alive (non-destroyed) instances for a given name. */
    private getAliveInstances(name: string): ElectroWindow[] {
        const list = this.instances.get(name);
        if (!list) return [];
        return list.filter((w) => !w.isDestroyed());
    }
}
