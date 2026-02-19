import type { WebContentsView } from "electron";

export type ViewId = string;

/** Runtime view registry entry — injected by CLI via __ELECTRO_VIEW_REGISTRY__. */
export interface ViewRegistryEntry {
    id: ViewId;
    hasRenderer: boolean;
    webPreferences?: Record<string, unknown>;
}

/** A WebContentsView augmented with `load()` for renderer-linked views. */
export type ElectroView = WebContentsView & {
    load(): Promise<void>;
};

/** Public interface — hides the View class. */
export interface ViewInstance {
    readonly id: ViewId;
    /** Create the WebContentsView. Idempotent: returns existing if alive. */
    create(): ElectroView;
    /** Return the live ElectroView, or null if not yet created / destroyed. */
    view(): ElectroView | null;
    /** Destroy the WebContentsView and clear refs. */
    destroy(): void;
}
