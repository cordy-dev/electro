import type { BaseWindow } from "electron";
import type { WindowConfig, WindowId } from "./types";

/**
 * Window — manages a single BaseWindow instance with an optional typed API.
 *
 * `create()` is idempotent: calling it while an alive window exists returns
 * the existing instance. After the window is destroyed (user close, etc.),
 * calling `create()` again spawns a fresh one.
 */
export class Window<TApi = void> {
    private _window: BaseWindow | null = null;
    private _api: TApi | null = null;

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
            this._api = this.config.api(this._window);
        }

        return this._window;
    }

    window(): BaseWindow | null {
        if (this._window?.isDestroyed()) {
            this._window = null;
            this._api = null;
        }
        return this._window;
    }

    api(): TApi | null {
        if (this._window?.isDestroyed()) {
            this._window = null;
            this._api = null;
        }
        return this._api;
    }

    destroy(): void {
        if (this._window && !this._window.isDestroyed()) {
            this._window.destroy();
        }
        this._window = null;
        this._api = null;
    }
}
