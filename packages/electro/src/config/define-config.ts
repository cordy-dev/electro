import type { DefineConfigInput, ElectroConfig } from "./types";

export function defineConfig(input: DefineConfigInput): ElectroConfig {
    const views = input.views ?? [];

    const seen = new Set<string>();
    for (const view of views) {
        if (seen.has(view.name)) {
            throw new Error(`[electro] defineConfig: duplicate view name "${view.name}"`);
        }
        seen.add(view.name);
    }

    return {
        runtime: input.runtime,
        views,
    } as ElectroConfig;
}
