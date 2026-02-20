import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { ElectroConfig } from "@cordy/electro";
import { generate as generateFiles, scan } from "@cordy/electro-generator";
import {
    createViewBridgeModuleContent,
    findBridgeTypesForView,
    generatedBridgeTypesPaths,
    isGeneratedBridgeTypesPath,
    resolveViewBridgePath,
} from "../dev/bridge-types";

interface GenerateOptions {
    config: string;
    output: string;
}

export async function generate(options: GenerateOptions): Promise<void> {
    const configPath = resolve(process.cwd(), options.config);
    const outputDir = resolve(process.cwd(), options.output);

    // 1. Load config
    const configModule = await import(configPath);
    const config: ElectroConfig = configModule.default;

    if (!config) {
        console.error("Error: electro.config.ts must have a default export");
        process.exit(1);
    }

    const views = config.views ?? [];
    console.log(`Loaded config with ${views.length} view(s)`);

    // 2. Scan source files
    const srcDir = resolve(process.cwd(), "src");
    console.log(`Scanning ${srcDir}...`);
    const scanResult = await scan(srcDir);
    console.log(`Found ${scanResult.features.length} feature(s)`);

    // 3. Generate output files
    const { files, envTypes } = generateFiles({ scanResult, views, outputDir, srcDir });
    console.log(`Generating ${files.length + 1} file(s)...`);

    // 4. Write to disk
    for (const file of files) {
        if (isGeneratedBridgeTypesPath(file.path)) continue;
        const fullPath = resolve(outputDir, file.path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, file.content);
        console.log(`  .electro/${file.path}`);
    }

    for (const view of views) {
        const bridge = findBridgeTypesForView(files, view.name);
        const bridgePath = resolveViewBridgePath(view);
        if (bridge && bridgePath) {
            await mkdir(dirname(bridgePath), { recursive: true });
            await writeFileIfChanged(bridgePath, createViewBridgeModuleContent(bridge.content));
            console.log(`  ${relative(process.cwd(), bridgePath)}`);
        }

        for (const relPath of generatedBridgeTypesPaths(view.name)) {
            const legacyPath = resolve(outputDir, relPath);
            try {
                await unlink(legacyPath);
            } catch {
                // Ignore when file does not exist.
            }
        }
    }

    const envTypesPath = resolve(srcDir, envTypes.path);
    await mkdir(dirname(envTypesPath), { recursive: true });
    await writeFile(envTypesPath, envTypes.content);
    console.log(`  src/${envTypes.path}`);

    console.log("Done.");
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
