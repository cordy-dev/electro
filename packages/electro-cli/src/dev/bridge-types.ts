import { dirname, resolve } from "node:path";
import type { ViewDefinition } from "@cordy/electro";
import type { GeneratedFile } from "@cordy/electro-generator";

const GENERATED_BRIDGE_DIRS = ["views", "windows"] as const;
const VIEW_BRIDGE_MODULE_FILE = "bridge.ts";

/**
 * Resolve generated bridge declaration file for a view.
 * Supports both historical `generated/windows/*` and current `generated/views/*`.
 */
export function findBridgeTypesForView(files: readonly GeneratedFile[], viewName: string): GeneratedFile | null {
    const byPath =
        files.find((f) => f.path === `generated/views/${viewName}.bridge.d.ts`) ??
        files.find((f) => f.path === `generated/windows/${viewName}.bridge.d.ts`);
    if (byPath) return byPath;

    return files.find((f) => f.path.endsWith(`/${viewName}.bridge.d.ts`)) ?? null;
}

/** Target location for per-view bridge types next to the config file. */
export function resolveViewBridgePath(view: ViewDefinition): string | null {
    if (!view.__source) return null;
    return resolve(dirname(view.__source), VIEW_BRIDGE_MODULE_FILE);
}

/** Convert generated bridge declaration content into runtime-accessible bridge module. */
export function createViewBridgeModuleContent(bridgeTypesContent: string): string {
    return `${bridgeTypesContent.trimEnd()}\n\nexport const electro = window.electro as ElectroBridge;\n`;
}

export function isGeneratedBridgeTypesPath(path: string): boolean {
    return GENERATED_BRIDGE_DIRS.some((dir) => path.startsWith(`generated/${dir}/`) && path.endsWith(".bridge.d.ts"));
}

export function generatedBridgeTypesPaths(viewName: string): string[] {
    return GENERATED_BRIDGE_DIRS.map((dir) => `generated/${dir}/${viewName}.bridge.d.ts`);
}
