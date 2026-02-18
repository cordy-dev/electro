import type { BaseWindow } from "electron";
import type { WindowDefinition } from "../config/types";
import type { WindowFactory } from "./types";

/**
 * Default WindowFactory — creates Electron BrowserWindow or BaseWindow
 * from a WindowDefinition at runtime.
 */
export function createDefaultWindowFactory(): WindowFactory {
    return {
        create(definition: WindowDefinition): BaseWindow {
            if (definition.type === "browser-window") {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { BrowserWindow } = require("electron") as typeof import("electron");
                return new BrowserWindow({
                    show: definition.autoShow ?? false,
                    ...((definition.window as Record<string, unknown>) ?? {}),
                });
            }
            const { BaseWindow: BW } = require("electron") as typeof import("electron");
            return new BW({
                show: definition.autoShow ?? false,
                ...((definition.window as Record<string, unknown>) ?? {}),
            });
        },
    };
}
