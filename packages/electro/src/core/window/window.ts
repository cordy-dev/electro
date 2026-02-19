import type { BaseWindow } from "electron";
import type { WindowConfig, WindowId } from "./types";

/**
 * Window — manages a single BaseWindow instance with an optional typed API.
 *
 * `create()` is idempotent: calling it while an alive window exists returns
 * the existing instance. After the window is destroyed (user close, etc.),
 * calling `create()` again spawns a fresh one.
 *
 * API methods from `config.api()` are mixed directly onto the instance
 * via Object.assign, so callers can do `window.show()` instead of `window.api?.show()`.
 */
export class Window<TApi = void> {
    private _window: BaseWindow | null = null;
    private _apiKeys: string[] | null = null;

    constructor(private readonly config: WindowConfig<TApi>) {}

    get id(): WindowId {
        return this.config.id;
    }

    create(): BaseWindow {
        if (this._window && !this._window.isDestroyed()) {
            return this._window;
        }

        const { BaseWindow: BW } = require("electron") as typeof import("electron");
        this._window = new BW({
            show: false,
            ...((this.config.options as Record<string, unknown>) ?? {}),
        });

        if (this.config.api) {
            const api = this.config.api(this._window);
            this._apiKeys = Object.keys(api as object);
            Object.assign(this, api);
        }

        return this._window;
    }

    get window(): BaseWindow | null {
        if (this._window?.isDestroyed()) {
            this._window = null;
            this.clearApi();
        }
        return this._window;
    }

    destroy(): void {
        if (this._window && !this._window.isDestroyed()) {
            this._window.destroy();
        }
        this._window = null;
        this.clearApi();
    }

    private clearApi(): void {
        if (this._apiKeys) {
            for (const key of this._apiKeys) {
                delete (this as Record<string, unknown>)[key];
            }
            this._apiKeys = null;
        }
    }
}
