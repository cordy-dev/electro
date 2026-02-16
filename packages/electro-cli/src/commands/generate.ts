import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generate as generateFiles } from "@cordy/electro-generator";
import { scan } from "@cordy/electro-generator";
import type { ElectroConfig } from "@cordy/electro";

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

    const windows = config.windows ?? [];
    console.log(`Loaded config with ${windows.length} window(s)`);

    // 2. Scan source files
    const srcDir = resolve(process.cwd(), "src");
    console.log(`Scanning ${srcDir}...`);
    const scanResult = await scan(srcDir);
    console.log(`Found ${scanResult.features.length} feature(s)`);

    // 3. Generate output files
    const { files, envTypes } = generateFiles({ scanResult, windows, outputDir, srcDir });
    console.log(`Generating ${files.length + 1} file(s)...`);

    // 4. Write to disk
    for (const file of files) {
        const fullPath = resolve(outputDir, file.path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, file.content);
        console.log(`  .electro/${file.path}`);
    }

    const envTypesPath = resolve(srcDir, envTypes.path);
    await mkdir(dirname(envTypesPath), { recursive: true });
    await writeFile(envTypesPath, envTypes.content);
    console.log(`  src/${envTypes.path}`);

    console.log("Done.");
}
