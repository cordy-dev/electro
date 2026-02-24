import { resolve } from "node:path";
import type { ViewDefinition } from "@cordy/electro";
import type { InlineConfig, Logger, Plugin, UserConfig } from "vite";
import { mergeConfig } from "vite";

export interface RendererConfigOptions {
    /** Project root */
    root: string;
    /** View definitions from config */
    views: readonly ViewDefinition[];
    /** User Vite configs to merge (from view definitions) */
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
    // Build multi-page input from view definitions
    // Each view entry is relative to its __source directory
    const input: Record<string, string> = {};
    for (const view of opts.views) {
        input[view.name] = resolve(view.root!, view.entry!);
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

    // Merge all view vite configs, deduplicating plugins by name
    if (opts.userViteConfigs?.length) {
        let merged = config;
        for (const userConfig of opts.userViteConfigs) {
            merged = mergeConfig(merged, userConfig) as InlineConfig;
        }
        merged.plugins = deduplicatePlugins(merged.plugins as Plugin[]);
        return merged;
    }

    return config;
}

/**
 * Deduplicate plugins by name — keeps the first occurrence of each named plugin.
 * This allows multiple views to declare the same plugins (e.g. react()) without
 * causing duplicate injection errors when configs are merged.
 */
function deduplicatePlugins(plugins: Plugin[]): Plugin[] {
    if (!plugins) return [];

    const seen = new Set<string>();
    const result: Plugin[] = [];

    for (const plugin of plugins.flat(Infinity) as Plugin[]) {
        const name = plugin?.name;
        if (!name) {
            result.push(plugin);
            continue;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        result.push(plugin);
    }

    return result;
}
