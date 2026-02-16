import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { createServer, version as viteVersion, build as viteBuild } from "vite";
import { generate } from "@cordy/electro-generator";
import { scan } from "@cordy/electro-generator";
import type { ScanResult } from "@cordy/electro-generator";
import type { ElectroConfig } from "@cordy/electro";
import { assetPlugin } from "../plugins/asset";
import { isolateEntriesPlugin } from "../plugins/isolate-entries";
import { modulePathPlugin } from "../plugins/module-path";
import { workerPlugin } from "../plugins/worker";
import { validateViteVersion } from "../validate";
import { loadConfig } from "./config-loader";
import type { ManagedProcess } from "./electron-launcher";
import { launchElectron } from "./electron-launcher";
import { resolveExternals } from "./externals";
import type { SessionMeta } from "./logger";
import {
    footer,
    info,
    note,
    patchLogger,
    runtimeLog,
    session,
    setLogLevel,
    startTimer,
    step,
    stepFail,
} from "./logger";
import { createNodeConfig } from "./vite-node-config";
import { createRendererConfig } from "./vite-renderer-config";

const MAIN_RESTART_DEBOUNCE_MS = 80;
const CONFIG_DEBOUNCE_MS = 300;

export interface DevServerOptions {
    configPath: string;
    logLevel?: "info" | "warn" | "error" | "silent";
    clearScreen?: boolean;
    rendererOnly?: boolean;
    sourcemap?: string;
    outDir?: string;
}

export class DevServer {
    private rendererServer: ViteDevServer | null = null;
    private electronProcess: ManagedProcess | null = null;
    private config: ElectroConfig | null = null;
    private root = "";
    private lastScanResult: ScanResult | null = null;
    private shuttingDown = false;
    private cleanedUp = false;

    // Restart state — mirrors deprecated CLI's robust restart logic
    private restartInFlight = false;
    private restartQueued = false;
    private restartQueuedFile: string | null = null;
    private mainRestartQueued = false;
    private mainRestartReason: string | null = null;
    private mainRestartFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private mainRestartFlushInFlight = false;

    private mainWatch: { close(): void } | null = null;
    private preloadWatch: { close(): void } | null = null;
    private outputDir = "";
    private readonly logLevel?: "info" | "warn" | "error" | "silent";
    private readonly clearScreen?: boolean;
    private readonly rendererOnly: boolean;
    private readonly sourcemap?: string;
    private readonly outDirOverride?: string;

    // Config watcher state
    private configPaths: Set<string> = new Set();
    private configDebounce: ReturnType<typeof setTimeout> | null = null;
    private onRestart: (() => void) | null = null;

    // Renderer URL for footer
    private rendererUrl: string | null = null;

    constructor(
        private configPath: string,
        opts?: Omit<DevServerOptions, "configPath">,
    ) {
        this.logLevel = opts?.logLevel;
        this.clearScreen = opts?.clearScreen;
        this.rendererOnly = opts?.rendererOnly ?? false;
        this.sourcemap = opts?.sourcemap;
        this.outDirOverride = opts?.outDir;

        if (this.logLevel) {
            setLogLevel(this.logLevel);
        }
    }

    async start(): Promise<void> {
        this.cleanedUp = false;
        this.shuttingDown = false;

        validateViteVersion(viteVersion);

        const totalTimer = startTimer();

        // 1. Load config
        const loaded = await loadConfig(this.configPath);
        this.config = loaded.config;
        this.root = loaded.root;
        this.outputDir = this.outDirOverride ? resolve(this.root, this.outDirOverride) : resolve(this.root, ".electro");

        // Track config paths for watching
        this.configPaths.add(loaded.configPath);
        for (const win of this.config.windows ?? []) {
            this.configPaths.add(win.__source);
        }

        // Print session banner
        const windows = this.config.windows ?? [];
        const srcDir = resolve(this.root, "src");

        const mainSourceDir = dirname(this.config.runtime.__source);
        const mainEntry = resolve(mainSourceDir, this.config.runtime.entry);

        const sessionMeta: SessionMeta = {
            root: this.root,
            main: mainEntry,
            preload: windows.length > 0 ? resolve(this.outputDir, "generated/preload") : null,
            renderer: windows.length > 0 ? resolve(this.root, dirname(relative(this.root, windows[0].__source))) : null,
            windows: windows.map((w) => ({
                name: w.name,
                entry: resolve(dirname(w.__source), w.entry),
            })),
        };
        session(sessionMeta);

        // 2. Run codegen
        const codegenTimer = startTimer();
        try {
            await this.runCodegen(this.outputDir, srcDir);
            step("codegen", codegenTimer());
        } catch (err) {
            stepFail("codegen", err instanceof Error ? err.message : String(err));
            throw err;
        }

        // 3. Start renderer dev server
        if (windows.length > 0) {
            const rendererTimer = startTimer();
            try {
                await this.startRenderer();
                step("renderer", rendererTimer());
            } catch (err) {
                stepFail("renderer", err instanceof Error ? err.message : String(err));
                throw err;
            }
        }

        // Renderer-only mode — skip preload, main, and Electron
        if (this.rendererOnly) {
            note("Renderer-only mode — skipping main, preload, Electron");
            footer(`Ready in ${totalTimer()}`, this.rendererUrl ?? undefined);
            this.attachConfigWatcher();
            return;
        }

        // 4. Resolve externals
        const externals = await resolveExternals(this.root);

        // 5. Build preload (watch mode)
        if (windows.length > 0) {
            const preloadTimer = startTimer();
            try {
                await this.buildPreload(externals);
                step("preload", preloadTimer());
            } catch (err) {
                stepFail("preload", err instanceof Error ? err.message : String(err));
                throw err;
            }
        }

        // 6. Build main (watch mode)
        const mainBuildTimer = startTimer();
        try {
            await this.buildMain(externals);
            step("main", mainBuildTimer());
        } catch (err) {
            stepFail("main", err instanceof Error ? err.message : String(err));
            throw err;
        }

        // 7. Launch Electron
        const electronTimer = startTimer();
        try {
            await this.attachElectronProcess();
            step("electron", electronTimer());
        } catch (err) {
            stepFail("electron", err instanceof Error ? err.message : String(err));
            throw err;
        }

        footer(`Ready in ${totalTimer()}`, this.rendererUrl ?? undefined);

        // 8. Watch config files
        this.attachConfigWatcher();
    }

    /** Register a callback for config-triggered restarts. */
    setOnRestart(fn: () => void): void {
        this.onRestart = fn;
    }

    /** Clean shutdown — idempotent, safe to call from any context. */
    stop(): void {
        if (this.cleanedUp) return;
        this.cleanedUp = true;
        this.shuttingDown = true;

        // Clear config watcher state
        if (this.configDebounce) {
            clearTimeout(this.configDebounce);
            this.configDebounce = null;
        }
        if (this.rendererServer?.watcher) {
            for (const configPath of this.configPaths) {
                this.rendererServer.watcher.unwatch(configPath);
            }
        }
        this.configPaths.clear();

        this.mainWatch?.close();
        this.mainWatch = null;
        this.preloadWatch?.close();
        this.preloadWatch = null;

        if (this.mainRestartFlushTimer) {
            clearTimeout(this.mainRestartFlushTimer);
            this.mainRestartFlushTimer = null;
        }

        if (this.rendererServer) {
            void this.rendererServer.close();
            this.rendererServer = null;
        }

        if (this.electronProcess) {
            const proc = this.electronProcess;
            this.electronProcess = null; // mark stale before kill
            proc.kill();
        }
    }

    // ── Internal methods ────────────────────────────────────

    private async runCodegen(outputDir: string, srcDir: string): Promise<void> {
        const scanResult = await scan(srcDir);
        this.lastScanResult = scanResult;

        const { files, envTypes } = generate({
            scanResult,
            windows: this.config!.windows ?? [],
            outputDir,
            srcDir,
        });

        await mkdir(outputDir, { recursive: true });

        for (const file of files) {
            const filePath = resolve(outputDir, file.path);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, file.content);
        }

        const envTypesPath = resolve(srcDir, envTypes.path);
        await mkdir(dirname(envTypesPath), { recursive: true });
        await writeFile(envTypesPath, envTypes.content);
    }

    private async startRenderer(): Promise<void> {
        const windows = this.config!.windows ?? [];
        const userViteConfigs = windows.filter((w) => w.vite).map((w) => w.vite!);

        const rendererConfig = createRendererConfig({
            root: this.root,
            windows,
            userViteConfigs: userViteConfigs.length > 0 ? userViteConfigs : undefined,
            logLevel: this.logLevel,
            clearScreen: this.clearScreen,
        });

        this.rendererServer = await createServer(rendererConfig);
        patchLogger(this.rendererServer.config.logger, "renderer");
        await this.rendererServer.listen();
        const addr = this.rendererServer.httpServer?.address();
        const portNum = typeof addr === "object" && addr ? addr.port : 5173;
        this.rendererUrl = `http://localhost:${portNum}`;
    }

    private async buildPreload(externals: (string | RegExp)[]): Promise<void> {
        const windows = this.config!.windows ?? [];
        const preloadOutDir = resolve(this.outputDir, "preload");

        const input: Record<string, string> = {};
        for (const win of windows) {
            input[win.name] = resolve(this.outputDir, `generated/preload/${win.name}.gen.ts`);
        }

        const firstEntry = Object.values(input)[0];

        const baseConfig = createNodeConfig({
            scope: "preload",
            root: this.root,
            entry: firstEntry,
            externals,
            outDir: preloadOutDir,
            watch: true,
            plugins: [assetPlugin(), workerPlugin(), modulePathPlugin()],
            logLevel: this.logLevel,
            clearScreen: this.clearScreen,
            sourcemap: this.sourcemap,
        });

        if (Object.keys(input).length > 1) {
            const subBuildConfig = createNodeConfig({
                scope: "preload",
                root: this.root,
                entry: firstEntry,
                externals,
                outDir: preloadOutDir,
                watch: false,
                plugins: [assetPlugin(), workerPlugin(), modulePathPlugin()],
                logLevel: this.logLevel,
                clearScreen: this.clearScreen,
                sourcemap: this.sourcemap,
            });
            (baseConfig.plugins as Plugin[]).push(isolateEntriesPlugin(subBuildConfig));
        }

        if (baseConfig.build) {
            baseConfig.build.rolldownOptions = {
                ...baseConfig.build.rolldownOptions,
                input,
            };
        }

        let firstBuild = true;
        const self = this;
        (baseConfig.plugins as Plugin[]).push({
            name: "electro:preload-watch",
            apply: "build",
            watchChange(id) {
                if (!firstBuild) {
                    const changed = relative(self.root, id);
                    runtimeLog("preload", "rebuild → page reload", changed);
                }
            },
            closeBundle() {
                if (firstBuild) {
                    firstBuild = false;
                    return;
                }
                if (self.rendererServer) {
                    self.rendererServer.ws.send({ type: "full-reload" });
                }
            },
        });

        const watcher = await viteBuild(baseConfig);
        this.preloadWatch = watcher as { close(): void };
    }

    private async buildMain(externals: (string | RegExp)[]): Promise<void> {
        const runtimeEntry = this.config!.runtime.entry;
        const sourceDir = dirname(this.config!.runtime.__source);
        const entry = resolve(sourceDir, runtimeEntry);

        // Serialize window definitions for runtime injection
        const windowDefs = (this.config!.windows ?? []).map((w) => ({
            name: w.name,
            type: w.type,
            lifecycle: w.lifecycle,
            autoShow: w.autoShow,
            behavior: w.behavior,
            window: w.window,
        }));

        const mainConfig = createNodeConfig({
            scope: "main",
            root: this.root,
            entry,
            externals,
            outDir: resolve(this.outputDir, "main"),
            watch: true,
            plugins: [assetPlugin(), workerPlugin(), modulePathPlugin()],
            logLevel: this.logLevel,
            clearScreen: this.clearScreen,
            userViteConfig: this.config!.runtime.vite,
            sourcemap: this.sourcemap,
            define: {
                __ELECTRO_WINDOW_DEFINITIONS__: JSON.stringify(windowDefs),
            },
        });

        const self = this;
        let firstBuild = true;
        let changedFile: string | null = null;

        (mainConfig.plugins as Plugin[]).push({
            name: "electro:main-watch",
            apply: "build",
            watchChange(id) {
                changedFile = changedFile ?? id;
            },
            async closeBundle() {
                if (firstBuild) {
                    firstBuild = false;
                    changedFile = null;
                    return;
                }

                const currentChanged = changedFile;
                changedFile = null;

                // Re-run codegen if scan result changed
                const srcDir = resolve(self.root, "src");
                const newScan = await scan(srcDir);
                if (JSON.stringify(newScan) !== JSON.stringify(self.lastScanResult)) {
                    runtimeLog("main", "generated");
                    await self.runCodegen(self.outputDir, srcDir);
                }

                self.queueMainRestart(currentChanged);
            },
        });

        const watcher = await viteBuild(mainConfig);
        this.mainWatch = watcher as { close(): void };
    }

    // ── Electron process management ─────────────────────────

    private async attachElectronProcess(): Promise<void> {
        const mainEntry = resolve(this.outputDir, "main/index.mjs");
        const env: Record<string, string> = {
            ELECTRO_DEV: "true",
        };

        if (this.rendererServer) {
            const addr = this.rendererServer.httpServer?.address();
            const port = typeof addr === "object" && addr ? addr.port : 5173;
            env.ELECTRO_RENDERER_BASE = `http://localhost:${port}`;

            for (const win of this.config!.windows ?? []) {
                const winSourceDir = dirname(win.__source);
                const entryPath = resolve(winSourceDir, win.entry);
                const relPath = relative(this.root, entryPath);
                env[`ELECTRO_DEV_URL_${win.name}`] = `http://localhost:${port}/${relPath}`;
            }
        }

        const proc = await launchElectron({
            root: this.root,
            entry: mainEntry,
            env,
        });
        this.electronProcess = proc;

        // Monitor exit — stale process guard: ignore if we already moved on
        void proc.exited.then((code) => {
            if (this.electronProcess !== proc) return;
            if (this.shuttingDown) return;

            if (code === 0) {
                runtimeLog("main", "exited");
            } else {
                runtimeLog("main", `crashed (exit ${code})`);
            }
            this.stop();
            process.exit(code === 0 ? 0 : 1);
        });
    }

    /**
     * Restart Electron — handles queued restarts if another rebuild
     * arrives while restart is in flight.
     */
    private async restartElectron(changedFile: string | null): Promise<void> {
        if (this.restartInFlight) {
            this.restartQueued = true;
            this.restartQueuedFile = changedFile ?? this.restartQueuedFile;
            return;
        }

        this.restartInFlight = true;
        let nextChanged: string | null = changedFile;

        do {
            this.restartQueued = false;
            const changed = nextChanged ? relative(this.root, nextChanged) : null;
            runtimeLog("main", "rebuild → restart", changed);
            nextChanged = null;

            if (this.electronProcess) {
                const prev = this.electronProcess;
                this.electronProcess = null; // mark stale before kill
                prev.kill();
                await prev.exited;
            }

            await this.attachElectronProcess();

            if (this.restartQueued) {
                nextChanged = this.restartQueuedFile;
                this.restartQueuedFile = null;
            }
        } while (this.restartQueued);

        this.restartInFlight = false;
    }

    // ── Debounced restart scheduling ────────────────────────

    private queueMainRestart(changedFile: string | null): void {
        if (changedFile) {
            this.mainRestartReason = changedFile;
        } else if (!this.mainRestartReason) {
            this.mainRestartReason = changedFile;
        }
        this.mainRestartQueued = true;
        this.scheduleMainRestartFlush();
    }

    private scheduleMainRestartFlush(): void {
        if (this.mainRestartFlushTimer) clearTimeout(this.mainRestartFlushTimer);
        this.mainRestartFlushTimer = setTimeout(() => {
            this.mainRestartFlushTimer = null;
            void this.flushMainRestartQueue();
        }, MAIN_RESTART_DEBOUNCE_MS);
    }

    private async flushMainRestartQueue(): Promise<void> {
        if (this.mainRestartFlushInFlight || !this.mainRestartQueued) return;
        this.mainRestartFlushInFlight = true;

        try {
            const reason = this.mainRestartReason;
            this.mainRestartQueued = false;
            this.mainRestartReason = null;
            await this.restartElectron(reason);
        } finally {
            this.mainRestartFlushInFlight = false;
            if (this.mainRestartQueued && !this.mainRestartFlushTimer) {
                this.scheduleMainRestartFlush();
            }
        }
    }

    // ── Config file watcher ─────────────────────────────────

    private attachConfigWatcher(): void {
        if (!this.rendererServer?.watcher) return;

        const watcher = this.rendererServer.watcher;

        for (const configPath of this.configPaths) {
            watcher.add(configPath);
        }

        watcher.on("change", (changedPath) => {
            if (!this.configPaths.has(changedPath)) return;
            if (this.shuttingDown) return;

            if (this.configDebounce) {
                clearTimeout(this.configDebounce);
            }

            this.configDebounce = setTimeout(() => {
                this.configDebounce = null;
                info("Config file changed, restarting...");
                this.stop();
                this.onRestart?.();
            }, CONFIG_DEBOUNCE_MS);
        });
    }
}
