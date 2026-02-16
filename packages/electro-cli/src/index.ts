#!/usr/bin/env bun
import cac from "cac";
import { version } from "../package.json";
import { build } from "./commands/build";
import { dev } from "./commands/dev";
import { generate } from "./commands/generate";
import { preview } from "./commands/preview";

const cli = cac("electro");

cli.command("generate", "Generate preload scripts, bridge types, and context types")
    .option("-c, --config <path>", "Path to electro.config.ts", { default: "electro.config.ts" })
    .option("-o, --output <dir>", "Output directory", { default: ".electro" })
    .action(generate);

cli.command("build", "Build for production")
    .option("-c, --config <path>", "Path to electro.config.ts", { default: "electro.config.ts" })
    .option("-o, --outDir <dir>", "Output directory", { default: "dist" })
    .option("--sourcemap <mode>", "Sourcemap mode (linked | inline | external | none)")
    .option("--minify", "Minify output (default: true)", { default: true })
    .option("--no-minify", "Disable minification")
    .option("--bytecode", "Compile main/preload to V8 bytecode for source protection")
    .option("-l, --logLevel <level>", "Log level (info | warn | error | silent)")
    .action(build);

cli.command("preview", "Build and preview in Electron")
    .option("-c, --config <path>", "Path to electro.config.ts", { default: "electro.config.ts" })
    .option("-o, --outDir <dir>", "Output directory", { default: "dist" })
    .option("--sourcemap <mode>", "Sourcemap mode (linked | inline | external | none)")
    .option("--minify", "Minify output (default: true)", { default: true })
    .option("--no-minify", "Disable minification")
    .option("--bytecode", "Compile main/preload to V8 bytecode for source protection")
    .option("--skip-build", "Skip build step and launch from existing output")
    .option("-l, --logLevel <level>", "Log level (info | warn | error | silent)")
    .action(preview);

cli.command("dev", "Start development server with Electron")
    .option("-c, --config <path>", "Path to electro.config.ts", { default: "electro.config.ts" })
    .option("--clearScreen", "Clear screen on rebuild", { default: true })
    .option("-l, --logLevel <level>", "Log level (info | warn | error | silent)")
    .option("--renderer-only", "Start only the renderer dev server (no Electron)")
    .option("--sourcemap <mode>", "Sourcemap mode (linked | inline | external | none)")
    .option("--outDir <dir>", "Output directory override (default: .electro)")
    .action(dev);

cli.help();
cli.version(version);
cli.parse();
