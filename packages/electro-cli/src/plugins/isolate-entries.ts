import { extname } from "node:path";
import type { InlineConfig, Plugin } from "vite";
import { mergeConfig, build as viteBuild } from "vite";

const VIRTUAL_ENTRY_ID = "\0electro:isolate-entries";

/**
 * Isolates multiple entry points into separate sub-builds.
 * Dormant (no-op) if only one entry detected.
 */
export function isolateEntriesPlugin(subBuildConfig: InlineConfig): Plugin {
    const emitted = new Set<string>();
    let entries: Record<string, string>[] | null = null;

    return {
        name: "electro:isolate-entries",
        apply: "build",

        options(opts) {
            const { input } = opts;
            if (!input || typeof input !== "object" || Array.isArray(input)) return;

            const keys = Object.keys(input);
            if (keys.length <= 1) return; // dormant: single entry

            entries = Object.entries(input as Record<string, string>).map(([k, v]) => ({ [k]: v }));
            opts.input = VIRTUAL_ENTRY_ID;
        },

        resolveId(id) {
            if (id === VIRTUAL_ENTRY_ID) return id;
            return null;
        },

        async load(id) {
            if (id !== VIRTUAL_ENTRY_ID || !entries) return;

            for (const entry of entries) {
                const config = mergeConfig(subBuildConfig, {
                    build: { write: false, watch: null },
                    plugins: [
                        {
                            name: "electro:entry-file-name",
                            outputOptions(output: { entryFileNames?: string }) {
                                if (output.entryFileNames && typeof output.entryFileNames === "string") {
                                    output.entryFileNames = `[name]${extname(output.entryFileNames)}`;
                                }
                            },
                        } satisfies Plugin,
                    ],
                    logLevel: "warn" as const,
                    configFile: false,
                }) as InlineConfig;

                // Override input for this entry
                if (config.build) {
                    config.build.rolldownOptions = {
                        ...config.build.rolldownOptions,
                        input: entry,
                    };
                }

                const result = (await viteBuild(config)) as {
                    output: Array<{ type: string; fileName: string; code?: string; source?: Uint8Array | string }>;
                };

                for (const chunk of result.output) {
                    if (emitted.has(chunk.fileName)) continue;
                    const source = chunk.type === "chunk" ? chunk.code : chunk.source;
                    if (source == null) continue;
                    this.emitFile({
                        type: "asset",
                        fileName: chunk.fileName,
                        source,
                    });
                    emitted.add(chunk.fileName);
                }
            }

            return "// virtual entry — removed in generateBundle";
        },

        generateBundle(_, bundle) {
            for (const name in bundle) {
                if (name.includes("isolate-entries")) {
                    delete bundle[name];
                }
            }
        },
    };
}
