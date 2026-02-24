import { DevServer } from "../dev/dev-server";
import { error } from "../dev/logger";
import { validateSourcemap } from "../validate";

interface DevOptions {
    config: string;
    clearScreen?: boolean;
    logLevel?: "info" | "warn" | "error" | "silent";
    rendererOnly?: boolean;
    sourcemap?: string;
    outDir?: string;
    inspect?: boolean | string;
    inspectBrk?: boolean | string;
    remoteDebuggingPort?: string;
    noSandbox?: boolean;
}

export async function dev(options: DevOptions): Promise<void> {
    if (options.remoteDebuggingPort) {
        process.env.REMOTE_DEBUGGING_PORT = options.remoteDebuggingPort;
    }

    // Set NODE_OPTIONS to pass debug flags to the Electron main process
    if (options.inspect) {
        const port = typeof options.inspect === "number" ? options.inspect : 9229; // 5858 is legacy
        process.env.NODE_OPTIONS = `--inspect=${port}`;
    }

    if (options.inspectBrk) {
        const port = typeof options.inspectBrk === "number" ? options.inspectBrk : 9229;
        process.env.NODE_OPTIONS = `--inspect-brk=${port}`;
    }

    if (options.noSandbox) {
        process.env.NO_SANDBOX = "1";
    }

    if ((options as any)["--"]) {
        process.env.ELECTRON_CLI_ARGS = JSON.stringify((options as any)["--"]);
    }

    if (options.sourcemap) {
        validateSourcemap(options.sourcemap);
    }

    process.env.ELECTRO_MODE = "development";

    const createServer = () =>
        new DevServer(options.config, {
            logLevel: options.logLevel,
            clearScreen: options.clearScreen,
            rendererOnly: options.rendererOnly,
            sourcemap: options.sourcemap,
            outDir: options.outDir,
        });

    let server = createServer();

    const shutdown = () => {
        server.stop();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Config-change restart loop
    const startWithRestart = async () => {
        server.setOnRestart(() => {
            server = createServer();
            void startWithRestart();
        });

        try {
            await server.start();
        } catch (err) {
            error(`Failed to start dev server: ${err instanceof Error ? err.message : String(err)}`);
            server.stop();
            process.exit(1);
        }
    };

    await startWithRestart();

    // Keep process alive — Electron exit and signals handle shutdown
    await new Promise(() => {});
}
