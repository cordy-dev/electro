import type { DefineConfigInput, ElectroConfig } from "./types";

export function defineConfig(input: DefineConfigInput): ElectroConfig {
    const windows = input.windows ?? [];

    const seen = new Set<string>();
    for (const win of windows) {
        if (seen.has(win.name)) {
            throw new Error(`[electro] defineConfig: duplicate window name "${win.name}"`);
        }
        seen.add(win.name);
    }

    return {
        runtime: input.runtime,
        windows,
    } as ElectroConfig;
}
