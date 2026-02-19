import type { WebContentsView } from "electron";

export type ViewId = string;

/** Config for renderer-linked views (built by Vite). */
export interface RendererViewConfig {
    id: ViewId;
    /** Link to a defineView() name. `true` = use `id` as the renderer name. */
    renderer: true | string;
    webPreferences?: Record<string, unknown>;
}

/** Config for dynamic views (no renderer entry, programmatic). */
export interface DynamicViewConfig {
    id: ViewId;
    webPreferences?: Record<string, unknown>;
}

export type ViewConfig = RendererViewConfig | DynamicViewConfig;

/** A WebContentsView augmented with `load()` for renderer-linked views. */
export type ElectroView = WebContentsView & {
    load(): Promise<void>;
};

/** Public interface — hides the View class. */
export interface CreatedView {
    readonly id: ViewId;
    /** Create the WebContentsView. Idempotent: returns existing if alive. */
    create(): ElectroView;
    /** Return the live ElectroView, or null if not yet created / destroyed. */
    view(): ElectroView | null;
    /** Destroy the WebContentsView and clear refs. */
    destroy(): void;
}

/** Type-erased interface for managers. */
export interface ViewInstance {
    readonly id: ViewId;
    create(): ElectroView;
    view(): ElectroView | null;
    destroy(): void;
}
