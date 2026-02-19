import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { InlineConfig, Logger, Plugin, UserConfig } from "vite";
import { mergeConfig } from "vite";
import type { NodeOutputFormat } from "./node-format";
import { cjsExternalInteropPlugin } from "../plugins/cjs-external-interop";
import { esmShimPlugin } from "../plugins/esm-shim";
import { importMetaPlugin } from "../plugins/import-meta";
import { enforceMergedNodeConfig, validateMergedNodeConfig } from "../validate";

export interface NodeConfigOptions {
    /** "main" or "preload" */
    scope: "main" | "preload";
    /** Absolute path to the scope root directory */
    root: string;
    /** Absolute path to the entry file */
    entry: string;
    /** Resolved externals from resolveExternals() */
    externals: (string | RegExp)[];
    /** Absolute path for build output */
    outDir: string;
    /** Enable watch mode */
    watch: boolean;
    /** Additional Vite plugins */
    plugins?: Plugin[];
    /** User Vite config to merge */
    userViteConfig?: UserConfig;
    /** Vite log level override */
    logLevel?: "info" | "warn" | "error" | "silent";
    /** Whether to clear the screen on rebuild */
    clearScreen?: boolean;
    /** Additional Vite define replacements */
    define?: Record<string, string>;
    /** Sourcemap mode override (linked | inline | external | none) */
    sourcemap?: string;
    /** Custom Vite logger (for build-mode output) */
    customLogger?: Logger;
    /** Output module format for Node scopes */
    format?: NodeOutputFormat;
    /** External dependency names that require CJS named-import interop in ESM output */
    cjsInteropDeps?: string[];
}

function resolveSourcemap(mode?: string): boolean | "inline" | "hidden" {
    if (!mode || mode === "linked" || mode === "external") return true;
    if (mode === "inline") return "inline";
    if (mode === "none") return false;
    return true;
}

export function createNodeConfig(opts: NodeConfigOptions): InlineConfig {
    const format = opts.format ?? "es";
    const moduleCondition = format === "cjs" ? "require" : "import";
    const resolveConditions =
        opts.scope === "preload" ? ["node", moduleCondition, "default"] : ["node", moduleCondition];
    const envPrefix = opts.scope === "main" ? ["MAIN_VITE_", "VITE_"] : ["PRELOAD_VITE_", "VITE_"];
    const entryExt = format === "cjs" ? "cjs" : "mjs";

    const config: InlineConfig = {
        configFile: false,
        root: opts.root,
        plugins: [
            importMetaPlugin(),
            ...(opts.plugins ?? []),
            cjsExternalInteropPlugin(opts.cjsInteropDeps ?? []),
            esmShimPlugin(),
        ],
        customLogger: opts.customLogger,
        envPrefix,

        // Preserve Node.js process.env access
        define: {
            "process.env": "process.env",
            ...opts.define,
        },

        build: {
            ssr: opts.entry,
            ssrEmitAssets: true,
            outDir: opts.outDir,
            emptyOutDir: true,
            rolldownOptions: {
                output: {
                    format,
                    entryFileNames: `index.${entryExt}`,
                },
                external: opts.externals,
            },
            target: "esnext",
            sourcemap: resolveSourcemap(opts.sourcemap),
            minify: false,
            modulePreload: false,
            watch: opts.watch ? {} : null,
            reportCompressedSize: !opts.watch,
        },

        ssr: {
            target: "node",
            noExternal: ["@cordy/electro"],
        },

        resolve: {
            conditions: resolveConditions,
        },

        logLevel: opts.logLevel ?? "warn",
        clearScreen: opts.clearScreen,
    };

    // For main scope, use resources/ as publicDir if it exists
    if (opts.scope === "main") {
        const resourcesDir = resolve(opts.root, "resources");
        if (existsSync(resourcesDir)) {
            config.publicDir = resourcesDir;
        }
    }

    // Merge user vite config if provided
    if (opts.userViteConfig) {
        const merged = mergeConfig(config, opts.userViteConfig) as InlineConfig;
        validateMergedNodeConfig(merged as Record<string, unknown>, opts.scope);
        enforceMergedNodeConfig(merged as Record<string, unknown>, opts.scope);
        return merged;
    }

    return config;
}
