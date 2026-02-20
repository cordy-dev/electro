import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ElectroView, ViewId, ViewRegistryEntry } from "./types";

/**
 * View — manages a single WebContentsView instance.
 *
 * `create()` is idempotent: calling it while an alive view exists returns
 * the existing instance. After the view is destroyed, calling `create()`
 * spawns a fresh one.
 *
 * For renderer-linked views, `load()` resolves the dev URL or production
 * file path automatically.
 */
export class View {
    private _view: ElectroView | null = null;

    constructor(private readonly entry: ViewRegistryEntry) {}

    get id(): ViewId {
        return this.entry.id;
    }

    create(): ElectroView {
        if (this._view && !this._view.webContents.isDestroyed()) {
            return this._view;
        }

        const { WebContentsView: WCV } = require("electron") as typeof import("electron");
        const webPreferences: Record<string, unknown> = {
            ...(this.entry.webPreferences ?? {}),
        };

        if (this.entry.hasRenderer && typeof webPreferences.preload !== "string") {
            const preloadPath = resolveDefaultPreloadPath(this.entry.id);
            if (preloadPath) {
                webPreferences.preload = preloadPath;
            }
        }

        const view = new WCV({ webPreferences }) as ElectroView;

        if (this.entry.hasRenderer) {
            const viewId = this.entry.id;
            view.load = async () => {
                const devUrl = process.env[`ELECTRO_DEV_URL_${viewId}`];
                if (devUrl) {
                    await view.webContents.loadURL(devUrl);
                    return;
                }
                const { app } = await import("electron");
                await view.webContents.loadFile(
                    join(app.getAppPath(), ".electro", "out", "renderer", viewId, "index.html"),
                );
            };
        } else {
            view.load = async () => {
                // Dynamic views load their own content — no-op
            };
        }

        this._view = view;
        return view;
    }

    view(): ElectroView | null {
        if (this._view?.webContents.isDestroyed()) {
            this._view = null;
        }
        return this._view;
    }

    destroy(): void {
        if (this._view && !this._view.webContents.isDestroyed()) {
            this._view.webContents.close();
        }
        this._view = null;
    }
}

const PRELOAD_EXTENSIONS = ["cjs", "mjs", "js"] as const;

function resolveDefaultPreloadPath(viewId: string): string | null {
    const preloadDir = join(import.meta.dirname, "..", "preload");

    for (const ext of PRELOAD_EXTENSIONS) {
        const byViewId = join(preloadDir, `${viewId}.${ext}`);
        if (existsSync(byViewId)) return byViewId;
    }

    for (const ext of PRELOAD_EXTENSIONS) {
        const singleEntryFallback = join(preloadDir, `index.${ext}`);
        if (existsSync(singleEntryFallback)) return singleEntryFallback;
    }

    return null;
}
