import type { BaseWindow, BaseWindowConstructorOptions } from "electron";

export type WindowId = string;

export interface WindowConfig<TApi = void> {
    id: WindowId;
    options?: BaseWindowConstructorOptions;
    api?: (window: BaseWindow) => TApi;
}

/** Base window interface (without API methods). */
interface WindowBase {
    readonly id: WindowId;
    /** Create the BaseWindow. Idempotent: returns existing if alive. */
    create(): BaseWindow;
    /** The live BaseWindow, or null if not yet created / destroyed. */
    readonly window: BaseWindow | null;
    /** Destroy the BaseWindow and clear refs. */
    destroy(): void;
}

/**
 * Public interface — API methods are mixed directly onto the object.
 * Access API methods directly: `window.show()` instead of `window.api?.show()`.
 */
export type CreatedWindow<TApi = void> = WindowBase &
    // biome-ignore lint/complexity/noBannedTypes: empty intersection is intentional for void API
    (TApi extends void ? {} : TApi) & {
        /** @internal Phantom type for API type inference. */
        readonly __apiType?: TApi;
    };

/** Type-erased interface for managers. */
export interface WindowInstance {
    readonly id: WindowId;
    create(): BaseWindow;
    readonly window: BaseWindow | null;
    destroy(): void;
}
