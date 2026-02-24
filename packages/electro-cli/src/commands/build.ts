import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { ElectroConfig } from "@cordy/electro";
import { generate, scan } from "@cordy/electro-generator";
import type { Plugin } from "vite";
import { build as viteBuild, version as viteVersion } from "vite";
import {
    createViewBridgeModuleContent,
    findBridgeTypesForView,
    generatedBridgeTypesPaths,
    isGeneratedBridgeTypesPath,
    resolveViewBridgePath,
} from "../dev/bridge-types";
import { loadConfig } from "../dev/config-loader";
import { resolveExternals } from "../dev/externals";
import type { SessionMeta } from "../dev/logger";
import {
    buildScope,
    createBuildLogger,
    footer,
    logSession,
    setLogLevel,
    startTimer,
    step,
    stepFail,
} from "../dev/logger";
import type { NodeOutputFormat } from "../dev/node-format";
import { resolveNodeOutputFormat } from "../dev/node-format";
import { createNodeConfig } from "../dev/vite-node-config";
import { createRendererConfig } from "../dev/vite-renderer-config";
import { assetPlugin } from "../plugins/asset";
import { bytecodePlugin } from "../plugins/bytecode";
import { isolateEntriesPlugin } from "../plugins/isolate-entries";
import { modulePathPlugin } from "../plugins/module-path";
import { workerPlugin } from "../plugins/worker";
import { validateSourcemap, validateViteVersion } from "../validate";

interface BuildOptions {
    config: string;
    outDir: string;
    sourcemap?: string;
    minify: boolean;
    logLevel?: "info" | "warn" | "error" | "silent";
    bytecode?: boolean;
}

export async function build(options: BuildOptions): Promise<void> {
    if (options.sourcemap) {
        validateSourcemap(options.sourcemap);
    }

    if (options.logLevel) {
        setLogLevel(options.logLevel);
    }

    const totalTimer = startTimer();

    // 1. Validate Vite version
    validateViteVersion(viteVersion);

    // 2. Load config
    const loaded = await loadConfig(options.config);
    const config = loaded.config;
    const root = loaded.root;
    const outDir = resolve(root, options.outDir);
    const codegenDir = resolve(root, ".electro");
    const nodeFormat = await resolveNodeOutputFormat(root);

    // 3. Print session banner
    const views = config.views ?? [];
    const rendererViews = views.filter((v) => v.entry);
    const srcDir = resolve(root, "src");
    const mainSourceDir = dirname(config.runtime.__source);
    const mainEntry = resolve(mainSourceDir, config.runtime.entry);

    const sessionMeta: SessionMeta = {
        root,
        runtime: mainEntry,
        preload: rendererViews.length > 0 ? resolve(codegenDir, "generated/preload") : null,
        renderer: rendererViews.length > 0 ? resolve(root, dirname(relative(root, rendererViews[0].__source))) : null,
        mode: "build",
        windows: rendererViews.map((w) => ({
            name: w.name,
            entry: resolve(dirname(w.__source), w.entry!),
        })),
    };
    logSession(sessionMeta);

    // 4. Codegen → .electro/generated/
    const codegenTimer = startTimer();
    try {
        const scanResult = await scan(srcDir);
        const { files, envTypes } = generate({
            scanResult,
            views,
            outputDir: codegenDir,
            srcDir,
        });

        await mkdir(codegenDir, { recursive: true });
        for (const file of files) {
            if (isGeneratedBridgeTypesPath(file.path)) continue;
            const filePath = resolve(codegenDir, file.path);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, file.content);
        }

        for (const view of views) {
            const bridge = findBridgeTypesForView(files, view.name);
            const bridgePath = resolveViewBridgePath(view);
            if (bridge && bridgePath) {
                await mkdir(dirname(bridgePath), { recursive: true });
                await writeFileIfChanged(bridgePath, createViewBridgeModuleContent(bridge.content));
            }

            for (const relPath of generatedBridgeTypesPaths(view.name)) {
                const legacyPath = resolve(codegenDir, relPath);
                try {
                    await unlink(legacyPath);
                } catch {
                    // Ignore when file does not exist.
                }
            }
        }

        const envTypesPath = resolve(srcDir, envTypes.path);
        await mkdir(dirname(envTypesPath), { recursive: true });
        await writeFileIfChanged(envTypesPath, envTypes.content);

        step("codegen", codegenTimer());
    } catch (err) {
        stepFail("codegen", err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    // 5. Resolve externals
    const resolvedExternals = await resolveExternals(root);
    const externals = resolvedExternals.externals;
    const cjsInteropDeps = resolvedExternals.cjsInteropDeps;

    // Build logger — suppresses Vite header, rebrands [vite] → [electro]
    const logger = createBuildLogger();

    // 6. Build main
    try {
        buildScope("main");
        await buildMain({
            config,
            root,
            outDir,
            externals,
            sourcemap: options.sourcemap,
            logger,
            bytecode: options.bytecode,
            format: nodeFormat,
            cjsInteropDeps,
        });
    } catch (err) {
        stepFail("main", err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    // 7. Build preload
    if (rendererViews.length > 0) {
        try {
            buildScope("preload");
            await buildPreload({
                config,
                root,
                outDir,
                codegenDir,
                externals,
                sourcemap: options.sourcemap,
                logger,
                bytecode: options.bytecode,
                format: nodeFormat,
                cjsInteropDeps,
            });
        } catch (err) {
            stepFail("preload", err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    }

    // 8. Build renderer
    if (rendererViews.length > 0) {
        try {
            buildScope("renderer");

            const userViteConfigs = rendererViews.filter((w) => w.vite).map((w) => w.vite!);

            const rendererConfig = createRendererConfig({
                root,
                views: rendererViews,
                userViteConfigs: userViteConfigs.length > 0 ? userViteConfigs : undefined,
                logLevel: "info",
                customLogger: logger,
                outDir: resolve(outDir, "renderer"),
                minify: options.minify,
                sourcemap: options.sourcemap,
            });

            await viteBuild(rendererConfig);

            // Flatten output: src/views/main/index.html → main/index.html
            await flattenRendererOutput(resolve(outDir, "renderer"), rendererViews, root);
        } catch (err) {
            stepFail("renderer", err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    }

    // 9. Footer with total time
    footer(`Built in ${totalTimer()}`, outDir);
}

async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
    try {
        const prev = await readFile(filePath, "utf-8");
        if (prev === content) return;
    } catch {
        // File does not exist yet.
    }

    await writeFile(filePath, content);
}

// ── Internal build helpers ──────────────────────────────────────────

interface MainBuildArgs {
    config: ElectroConfig;
    root: string;
    outDir: string;
    externals: (string | RegExp)[];
    sourcemap?: string;
    logger: import("vite").Logger;
    bytecode?: boolean;
    format: NodeOutputFormat;
    cjsInteropDeps: string[];
}

async function buildMain(args: MainBuildArgs): Promise<void> {
    const runtimeEntry = args.config.runtime.entry;
    const sourceDir = dirname(args.config.runtime.__source);
    const entry = resolve(sourceDir, runtimeEntry);

    const viewRegistry = (args.config.views ?? []).map((v) => ({
        id: v.name,
        hasRenderer: !!v.entry,
        features: v.features ?? [],
        webPreferences: sanitizeRuntimeWebPreferences(v.webPreferences),
    }));

    const mainConfig = createNodeConfig({
        scope: "main",
        root: args.root,
        entry,
        externals: args.externals,
        outDir: resolve(args.outDir, "main"),
        watch: false,
        plugins: [assetPlugin(), workerPlugin(), modulePathPlugin(), ...(args.bytecode ? [bytecodePlugin()] : [])],
        userViteConfig: args.config.runtime.vite,
        sourcemap: args.sourcemap,
        customLogger: args.logger,
        logLevel: "info",
        format: args.format,
        cjsInteropDeps: args.cjsInteropDeps,
        define: {
            __ELECTRO_VIEW_REGISTRY__: JSON.stringify(viewRegistry),
        },
    });

    await viteBuild(mainConfig);
}

interface PreloadBuildArgs {
    config: ElectroConfig;
    root: string;
    outDir: string;
    codegenDir: string;
    externals: (string | RegExp)[];
    sourcemap?: string;
    logger: import("vite").Logger;
    bytecode?: boolean;
    format: NodeOutputFormat;
    cjsInteropDeps: string[];
}

async function buildPreload(args: PreloadBuildArgs): Promise<void> {
    const views = (args.config.views ?? []).filter((v) => v.entry);

    const input: Record<string, string> = {};
    for (const view of views) {
        input[view.name] = resolve(args.codegenDir, `generated/preload/${view.name}.gen.ts`);
    }

    const firstEntry = Object.values(input)[0];
    const preloadOutDir = resolve(args.outDir, "preload");

    const preloadPlugins: Plugin[] = [
        assetPlugin(),
        workerPlugin(),
        modulePathPlugin(),
        ...(args.bytecode ? [bytecodePlugin()] : []),
    ];

    const baseConfig = createNodeConfig({
        scope: "preload",
        root: args.root,
        entry: firstEntry,
        externals: args.externals,
        outDir: preloadOutDir,
        watch: false,
        plugins: preloadPlugins,
        sourcemap: args.sourcemap,
        customLogger: args.logger,
        logLevel: "info",
        // Sandboxed preload should be emitted as CJS for stable execution.
        format: "cjs",
        cjsInteropDeps: args.cjsInteropDeps,
    });

    if (Object.keys(input).length > 1) {
        const subBuildConfig = createNodeConfig({
            scope: "preload",
            root: args.root,
            entry: firstEntry,
            externals: args.externals,
            outDir: preloadOutDir,
            watch: false,
            plugins: [assetPlugin(), workerPlugin(), modulePathPlugin()],
            sourcemap: args.sourcemap,
            customLogger: args.logger,
            logLevel: "info",
            format: "cjs",
            cjsInteropDeps: args.cjsInteropDeps,
        });
        (baseConfig.plugins as Plugin[]).push(isolateEntriesPlugin(subBuildConfig));
    }

    if (baseConfig.build) {
        baseConfig.build.rolldownOptions = {
            ...baseConfig.build.rolldownOptions,
            input,
        };
    }

    await viteBuild(baseConfig);
}

function sanitizeRuntimeWebPreferences(webPreferences: Record<string, unknown> | undefined): Record<string, unknown> {
    const prefs = { ...(webPreferences ?? {}) };
    delete prefs.preload;
    return prefs;
}

// ── Renderer output flattening ──────────────────────────────────────

/**
 * Flatten renderer HTML output from source-relative paths
 * (e.g., `src/windows/main/index.html`) to `{name}/index.html`.
 * Adjusts relative asset references to match the new depth.
 */
async function flattenRendererOutput(
    rendererDir: string,
    views: readonly import("@cordy/electro").ViewDefinition[],
    root: string,
): Promise<void> {
    const dirsToClean = new Set<string>();

    for (const view of views) {
        const sourceDir = dirname(view.__source);
        const entryPath = resolve(sourceDir, view.entry);
        const relPath = relative(root, entryPath);

        const oldHtmlPath = resolve(rendererDir, relPath);
        const newHtmlPath = resolve(rendererDir, view.name, "index.html");

        if (oldHtmlPath === newHtmlPath) continue;

        // Read HTML and adjust relative asset paths
        let html = await readFile(oldHtmlPath, "utf-8");
        const oldDepth = relPath.split("/").length - 1;
        const newDepth = 1; // {name}/index.html
        const depthDiff = oldDepth - newDepth;

        if (depthDiff > 0) {
            html = html.replace(/(["'(])((?:\.\.\/)+)/g, (_, prefix: string, dots: string) => {
                const levels = (dots.match(/\.\.\//g) || []).length;
                const adjusted = Math.max(0, levels - depthDiff);
                return prefix + (adjusted > 0 ? "../".repeat(adjusted) : "./");
            });
        }

        await mkdir(dirname(newHtmlPath), { recursive: true });
        await writeFile(newHtmlPath, html);
        await unlink(oldHtmlPath);

        // Track the top-level source directory for cleanup
        const topDir = relPath.split("/")[0];
        if (topDir !== view.name) {
            dirsToClean.add(resolve(rendererDir, topDir));
        }
    }

    // Remove empty source directory trees
    for (const dir of dirsToClean) {
        await rm(dir, { recursive: true, force: true });
    }
}
