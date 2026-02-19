import type { BaseWindow } from "electron";

export type WindowId = string;

export interface WindowConfig<TApi = void> {
    id: WindowId;
    options?: Record<string, unknown>;
    api?: (window: BaseWindow) => TApi;
}

/** Public interface — hides the Window class. */
export interface CreatedWindow<TApi = void> {
    readonly id: WindowId;
    /** Create the BaseWindow. Idempotent: returns existing if alive. */
    create(): BaseWindow;
    /** Return the live BaseWindow, or null if not yet created / destroyed. */
    window(): BaseWindow | null;
    /** Return the typed API, or null if not yet created / destroyed. */
    api(): TApi | null;
    /** Destroy the BaseWindow and clear refs. */
    destroy(): void;
}

/** Type-erased interface for managers. */
export interface WindowInstance {
    readonly id: WindowId;
    create(): BaseWindow;
    window(): BaseWindow | null;
    api(): unknown;
    destroy(): void;
}
