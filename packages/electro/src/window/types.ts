import type { BaseWindow } from "electron";
import type { WindowDefinition } from "../config/types";

/** A window with an auto-loading `load()` method that resolves dev/prod URLs. */
export type ElectroWindow<T extends BaseWindow = BaseWindow> = T & {
    load(): Promise<void>;
};

/** Factory interface for creating platform windows from definitions. */
export interface WindowFactory {
    create(definition: WindowDefinition): BaseWindow;
}

/** Snapshot of a tracked window. */
export interface WindowInfo {
    name: string;
    windowId: number;
    destroyed: boolean;
}
