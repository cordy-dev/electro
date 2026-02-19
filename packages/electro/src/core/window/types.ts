import type { BaseWindow, BaseWindowConstructorOptions } from "electron";

export type WindowId = string;

export interface WindowConfig<TApi = void> {
    id: WindowId;
    options?: BaseWindowConstructorOptions;
    api?: (window: BaseWindow) => TApi;
}

/** Public interface — hides the Window class. */
export interface CreatedWindow<TApi = void> {
    readonly id: WindowId;
    /** Create the BaseWindow. Idempotent: returns existing if alive. */
    create(): BaseWindow;
    /** The live BaseWindow, or null if not yet created / destroyed. */
    readonly window: BaseWindow | null;
    /** The typed API, or null if not yet created / destroyed. */
    readonly api: TApi | null;
    /** Destroy the BaseWindow and clear refs. */
    destroy(): void;
}

/** Type-erased interface for managers. */
export interface WindowInstance {
    readonly id: WindowId;
    create(): BaseWindow;
    readonly window: BaseWindow | null;
    readonly api: unknown;
    destroy(): void;
}
