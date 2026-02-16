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
}

export async function dev(options: DevOptions): Promise<void> {
    if (options.sourcemap) {
        validateSourcemap(options.sourcemap);
    }

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
