import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ElectroConfig } from "@cordy/electro";
import { validateConfig } from "../validate";

export interface LoadedConfig {
    config: ElectroConfig;
    /** Absolute path to the config file */
    configPath: string;
    /** Project root (directory containing config) */
    root: string;
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
    const absolutePath = resolve(process.cwd(), configPath);
    const root = dirname(absolutePath);

    if (!existsSync(absolutePath)) {
        throw new Error(`Config file not found: ${absolutePath}`);
    }

    const configModule = await import(absolutePath);
    const config: ElectroConfig = configModule.default;

    if (!config) {
        throw new Error(`${configPath} must have a default export`);
    }

    if (!config.runtime) {
        throw new Error(`${configPath} must define a runtime via defineRuntime()`);
    }

    validateConfig(config);

    return { config, configPath: absolutePath, root };
}
