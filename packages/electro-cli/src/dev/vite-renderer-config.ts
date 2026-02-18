import { dirname, resolve } from "node:path";
import type { WindowDefinition } from "@cordy/electro";
import type { InlineConfig, Logger, UserConfig } from "vite";
import { mergeConfig } from "vite";

export interface RendererConfigOptions {
    /** Project root */
    root: string;
    /** Window definitions from config */
    windows: readonly WindowDefinition[];
    /** User Vite configs to merge (from window definitions) */
    userViteConfigs?: UserConfig[];
    /** Vite log level override */
    logLevel?: "info" | "warn" | "error" | "silent";
    /** Whether to clear the screen on rebuild */
    clearScreen?: boolean;
    /** Production build output directory — when set, produces a build instead of dev server config */
    outDir?: string;
    /** Minify output (default true when outDir is set) */
    minify?: boolean;
    /** Sourcemap mode (linked | inline | external | none) */
    sourcemap?: string;
    /** Custom Vite logger (for build-mode output) */
    customLogger?: Logger;
}

function resolveSourcemap(mode?: string): boolean | "inline" | "hidden" {
    if (!mode || mode === "linked" || mode === "external") return true;
    if (mode === "inline") return "inline";
    if (mode === "none") return false;
    return true;
}

export function createRendererConfig(opts: RendererConfigOptions): InlineConfig {
    // Build multi-page input from window definitions
    // Each window entry is relative to its __source directory
    const input: Record<string, string> = {};
    for (const win of opts.windows) {
        const sourceDir = dirname(win.__source);
        input[win.name] = resolve(sourceDir, win.entry);
    }

    const isBuild = !!opts.outDir;

    const config: InlineConfig = {
        configFile: false,
        root: opts.root,
        customLogger: opts.customLogger,
        envPrefix: ["RENDERER_VITE_", "VITE_"],

        // Dev server config — omitted in build mode
        ...(!isBuild && {
            server: {
                strictPort: false,
            },
        }),

        // Use relative base for file:// protocol compatibility in production
        ...(isBuild && { base: "./" }),

        build: {
            rolldownOptions: {
                input,
            },
            ...(isBuild && {
                outDir: opts.outDir,
                emptyOutDir: true,
                minify: opts.minify ?? true,
                sourcemap: resolveSourcemap(opts.sourcemap),
                reportCompressedSize: true,
                modulePreload: { polyfill: false },
            }),
        },

        logLevel: opts.logLevel ?? "info",
        clearScreen: opts.clearScreen,
    };

    // Merge all window vite configs
    if (opts.userViteConfigs?.length) {
        let merged = config;
        for (const userConfig of opts.userViteConfigs) {
            merged = mergeConfig(merged, userConfig) as InlineConfig;
        }
        return merged;
    }

    return config;
}
