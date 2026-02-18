#!/usr/bin/env bun

/**
 * Publish script — builds, tests, and publishes all packages to npm in dependency order.
 *
 * Usage:
 *   bun scripts/publish.ts            # publish all packages
 *   bun scripts/publish.ts --dry-run  # preview without publishing
 *
 * Prerequisites:
 *   - Clean git working directory
 *   - Logged into npm: bunx npm login
 *   - Or set NPM_TOKEN env var
 */

import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** Packages in dependency order (leaf → dependents). */
const PACKAGES = ["packages/electro", "packages/electro-generator", "packages/electro-cli"] as const;

function run(cmd: string[], opts?: { cwd?: string }): void {
    const cwd = opts?.cwd ?? root;
    console.log(`  $ ${cmd.join(" ")}${cwd !== root ? ` (in ${cwd})` : ""}`);
    const result = Bun.spawnSync(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
    if (result.exitCode !== 0) {
        console.error(`\nCommand failed with exit code ${result.exitCode}: ${cmd.join(" ")}`);
        process.exit(1);
    }
}

function gitIsClean(): boolean {
    const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: root });
    return result.stdout.toString().trim() === "";
}

// ── Main ──

const dryRun = process.argv.includes("--dry-run");

console.log(`\n📦 Publishing packages${dryRun ? " (dry run)" : ""}\n`);

// 1. Check clean working directory
if (!dryRun && !gitIsClean()) {
    console.error("Error: git working directory is not clean. Commit or stash changes first.");
    process.exit(1);
}

// 2. Build all packages
console.log("Building...\n");
run(["bun", "run", "build"]);

// 3. Run tests
console.log("\nRunning tests...\n");
run(["bun", "run", "test"]);

// 4. Publish in dependency order
console.log("\nPublishing...\n");
for (const pkg of PACKAGES) {
    const cwd = resolve(root, pkg);
    const cmd = ["bun", "publish", "--access", "public"];
    if (dryRun) cmd.push("--dry-run");
    run(cmd, { cwd });
    console.log("");
}

console.log("Done!\n");
