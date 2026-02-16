import { extname } from "node:path";
import MagicString from "magic-string";
import type { InlineConfig, Plugin, ResolvedConfig } from "vite";
import { mergeConfig, build as viteBuild } from "vite";
import { cleanUrl, toRelativePath } from "./utils";

const MODULE_PATH_RE = /__ELECTRO_MODULE_PATH__([\w$]+)__/g;

/** Plugins to exclude from sub-build configs to prevent recursion. */
const EXCLUDED_PLUGINS = new Set(["electro:module-path", "electro:isolate-entries", "electro:bytecode"]);

/**
 * Handles `?modulePath` imports in main/preload scopes.
 *
 * Builds the referenced file as a fully isolated bundle via `viteBuild()`
 * and returns its runtime filesystem path. Guarantees self-contained output
 * with no shared chunks — safe for `child_process.fork()`.
 *
 * Usage:
 *   import taskPath from './task.ts?modulePath'
 *   fork(taskPath)
 */
export function modulePathPlugin(): Plugin {
    const assetCache = new Set<string>();
    let resolvedConfig: ResolvedConfig;

    return {
        name: "electro:module-path",
        apply: "build",
        enforce: "pre",

        configResolved(config): void {
            resolvedConfig = config;
        },

        buildStart(): void {
            assetCache.clear();
        },

        async load(id): Promise<string | undefined> {
            if (!id.endsWith("?modulePath")) return;

            const file = cleanUrl(id);
            const subConfig = createSubBuildConfig(resolvedConfig);
            const result = await bundleModulePath(file, subConfig, this.meta.watchMode);

            // Emit main output chunk as an asset
            const [mainChunk, ...otherChunks] = result.output;
            const refId = this.emitFile({
                type: "asset",
                fileName: mainChunk.fileName,
                source: mainChunk.code ?? "",
            });

            // Emit additional chunks/assets from the sub-build
            for (const chunk of otherChunks) {
                if (assetCache.has(chunk.fileName)) continue;
                const source = chunk.type === "chunk" ? chunk.code : chunk.source;
                if (source == null) continue;
                this.emitFile({
                    type: "asset",
                    fileName: chunk.fileName,
                    source,
                });
                assetCache.add(chunk.fileName);
            }

            for (const watchFile of result.watchFiles) {
                this.addWatchFile(watchFile);
            }

            const assetRef = `__ELECTRO_MODULE_PATH__${refId}__`;
            return [`import { join } from 'path'`, `export default join(import.meta.dirname, ${assetRef})`].join("\n");
        },

        renderChunk(code, chunk, opts) {
            MODULE_PATH_RE.lastIndex = 0;
            let match = MODULE_PATH_RE.exec(code);
            if (!match) return null;

            const sourcemap = typeof opts === "object" && "sourcemap" in opts ? opts.sourcemap : false;
            const s = new MagicString(code);

            while (match) {
                const [full, hash] = match;
                const filename = this.getFileName(hash);
                const replacement = JSON.stringify(toRelativePath(chunk.fileName, filename));
                s.overwrite(match.index, match.index + full.length, replacement, { contentOnly: true });
                match = MODULE_PATH_RE.exec(code);
            }

            return {
                code: s.toString(),
                map: sourcemap ? s.generateMap({ hires: "boundary" }) : null,
            };
        },
    };
}

// ── Sub-build helpers ───────────────────────────────────────────────

interface SubBuildOutput {
    fileName: string;
    type: "chunk" | "asset";
    code?: string;
    source?: string | Uint8Array;
}

/** Create a sub-build config from resolved config, stripping recursive plugins. */
function createSubBuildConfig(config: ResolvedConfig): InlineConfig {
    const plugins = (config.plugins ?? []).filter((p) => !EXCLUDED_PLUGINS.has(p.name));

    return {
        configFile: false,
        root: config.root,
        mode: config.mode,
        envDir: config.envDir,
        envPrefix: config.envPrefix,
        plugins,
        resolve: config.resolve,
        define: config.define,
        build: {
            ssr: config.build.ssr,
            outDir: config.build.outDir,
            rolldownOptions: {
                output: config.build.rolldownOptions.output,
                external: config.build.rolldownOptions.external,
            },
            target: config.build.target,
            sourcemap: config.build.sourcemap,
            minify: config.build.minify,
        },
        ssr: config.ssr,
        logLevel: "warn",
    };
}

/** Collect source files from a sub-build for watch-mode tracking. */
function watchCollectorPlugin(watchFiles: string[]): Plugin {
    return {
        name: "electro:module-path-watch",
        buildEnd(): void {
            for (const id of this.getModuleIds()) {
                if (id.includes("node_modules") || id.startsWith("\0")) continue;
                const info = this.getModuleInfo(id);
                if (info?.code != null) {
                    watchFiles.push(id);
                }
            }
        },
    };
}

/** Build a ?modulePath import as a fully isolated bundle. */
async function bundleModulePath(
    input: string,
    config: InlineConfig,
    watch: boolean,
): Promise<{ output: SubBuildOutput[]; watchFiles: string[] }> {
    const watchFiles: string[] = [];

    const subConfig = mergeConfig(config, {
        build: {
            write: false,
            watch: false,
        },
        plugins: [
            {
                name: "electro:module-path-entry-name",
                outputOptions(output: { entryFileNames?: string }): void {
                    if (typeof output.entryFileNames !== "function" && output.entryFileNames) {
                        output.entryFileNames = `[name]-[hash]${extname(output.entryFileNames)}`;
                    }
                },
            } satisfies Plugin,
            ...(watch ? [watchCollectorPlugin(watchFiles)] : []),
        ],
        logLevel: "warn" as const,
        configFile: false,
    }) as InlineConfig;

    if (subConfig.build) {
        subConfig.build.rolldownOptions = {
            ...subConfig.build?.rolldownOptions,
            input,
            plugins: [...((subConfig.build?.rolldownOptions?.plugins as Plugin[]) ?? [])],
        };
    }

    const result = (await viteBuild(subConfig)) as { output: SubBuildOutput[] };

    return {
        output: result.output,
        watchFiles,
    };
}
