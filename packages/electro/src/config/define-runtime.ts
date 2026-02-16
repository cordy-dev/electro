import { getCallerPath } from "./caller";
import type { DefineRuntimeInput, RuntimeDefinition } from "./types";

export function defineRuntime(input: DefineRuntimeInput): RuntimeDefinition {
    if (!input.entry || input.entry.trim().length === 0) {
        throw new Error("[electro] defineRuntime: entry must be a non-empty string");
    }

    return {
        entry: input.entry,
        vite: input.vite,
        __source: getCallerPath() ?? "",
    } as RuntimeDefinition;
}
