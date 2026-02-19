import { getCallerPath } from "./caller";
import type { DefineViewInput, ViewDefinition } from "./types";

const VIEW_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function defineView(input: DefineViewInput): ViewDefinition {
    if (!input.name || input.name.trim().length === 0) {
        throw new Error("[electro] defineView: name must be a non-empty string");
    }

    if (!VIEW_NAME_PATTERN.test(input.name)) {
        throw new Error(
            `[electro] defineView: name "${input.name}" is invalid. Must match ${VIEW_NAME_PATTERN.toString()}`,
        );
    }

    return {
        name: input.name,
        entry: input.entry,
        features: input.features,
        vite: input.vite,
        preload: input.preload,
        webPreferences: input.webPreferences,
        __source: getCallerPath() ?? "",
    } as ViewDefinition;
}
