import { getCallerPath } from "./caller";
import type { DefineWindowInput, WindowDefinition } from "./types";

const WINDOW_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function defineWindow(input: DefineWindowInput): WindowDefinition {
    if (!input.name || input.name.trim().length === 0) {
        throw new Error("[electro] defineWindow: name must be a non-empty string");
    }

    if (!WINDOW_NAME_PATTERN.test(input.name)) {
        throw new Error(
            `[electro] defineWindow: name "${input.name}" is invalid. Must match ${WINDOW_NAME_PATTERN.toString()}`,
        );
    }

    if (!input.entry || input.entry.trim().length === 0) {
        throw new Error("[electro] defineWindow: entry must be a non-empty string");
    }

    const lifecycle = input.lifecycle ?? "singleton";
    const close = input.behavior?.close ?? (lifecycle === "multi" ? "destroy" : "hide");

    if (lifecycle === "multi" && close === "hide") {
        throw new Error(
            '[electro] defineWindow: behavior.close "hide" is only allowed with lifecycle "singleton". Multi-instance windows must use "destroy".',
        );
    }

    return {
        name: input.name,
        entry: input.entry,
        type: input.type,
        features: input.features,
        vite: input.vite,
        preload: input.preload,
        lifecycle,
        autoShow: input.autoShow ?? false,
        behavior: { close },
        window: input.window,
        __source: getCallerPath() ?? "",
    } as WindowDefinition;
}
