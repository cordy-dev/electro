import { join } from "node:path";
import type { ElectroView, RendererViewConfig, ViewConfig, ViewId } from "./types";

function isRendererConfig(config: ViewConfig): config is RendererViewConfig {
    return "renderer" in config;
}

function resolveRendererName(config: RendererViewConfig): string {
    return config.renderer === true ? config.id : config.renderer;
}

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

    constructor(private readonly config: ViewConfig) {}

    get id(): ViewId {
        return this.config.id;
    }

    create(): ElectroView {
        if (this._view && !this._view.webContents.isDestroyed()) {
            return this._view;
        }

        const { WebContentsView: WCV } = require("electron") as typeof import("electron");
        const webPreferences: Record<string, unknown> = {
            ...(this.config.webPreferences ?? {}),
        };

        const view = new WCV({ webPreferences }) as ElectroView;

        // Augment load()
        if (isRendererConfig(this.config)) {
            const rendererName = resolveRendererName(this.config);
            view.load = async () => {
                const devUrl = process.env[`ELECTRO_DEV_URL_${rendererName}`];
                if (devUrl) {
                    await view.webContents.loadURL(devUrl);
                    return;
                }
                const { app } = await import("electron");
                await view.webContents.loadFile(
                    join(app.getAppPath(), ".electro", "out", "renderer", rendererName, "index.html"),
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
