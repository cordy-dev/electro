import { resolve } from "node:path";
import { launchElectron } from "../dev/electron-launcher";
import { footer, note, runtimeLog, setLogLevel, startTimer, step, stepFail } from "../dev/logger";
import { resolveMainEntryPath } from "../dev/node-format";
import { validateSourcemap } from "../validate";
import { build } from "./build";

interface PreviewOptions {
    config: string;
    outDir: string;
    sourcemap?: string;
    minify: boolean;
    logLevel?: "info" | "warn" | "error" | "silent";
    skipBuild?: boolean;
}

export async function preview(options: PreviewOptions): Promise<void> {
    if (options.sourcemap) {
        validateSourcemap(options.sourcemap);
    }

    if (options.logLevel) {
        setLogLevel(options.logLevel);
    }

    const totalTimer = startTimer();

    // 1. Build (unless skipped)
    if (!options.skipBuild) {
        await build(options);
    } else {
        note("Skipped build (--skip-build)");
    }

    // 2. Launch Electron with the built output
    const root = process.cwd();
    const outDir = resolve(root, options.outDir);
    const mainEntry = await resolveMainEntryPath(resolve(outDir, "main"));

    const launchTimer = startTimer();
    try {
        const proc = await launchElectron({
            root,
            entry: mainEntry,
        });
        step("electron", launchTimer());
        footer(`Preview ready in ${totalTimer()}`);

        // Forward signals to Electron for graceful shutdown
        const onSignal = () => proc.kill();
        process.on("SIGINT", onSignal);
        process.on("SIGTERM", onSignal);

        // Wait for Electron to exit
        const exitCode = await proc.exited;
        const code = exitCode ?? 0;

        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);

        if (code === 0) {
            runtimeLog("main", "exited");
        } else {
            runtimeLog("main", `crashed (exit ${code})`);
            process.exit(1);
        }
    } catch (err) {
        stepFail("electron", err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
