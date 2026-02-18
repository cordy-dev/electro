#!/usr/bin/env bun

/**
 * Publish script — builds, tests, and publishes all packages to npm in dependency order.
 *
 * Before publishing each package, resolves `workspace:*` references in
 * dependencies and peerDependencies to the actual package version so that
 * the published tarball contains real semver ranges. After publishing,
 * the original `workspace:*` references are restored.
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

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** Packages in dependency order (leaf → dependents). */
const PACKAGES = ["packages/electro", "packages/electro-generator", "packages/electro-cli"] as const;

type PackageJson = Record<string, unknown>;

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

/** Build a map of package name → version from all workspace packages. */
async function buildVersionMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const pkg of PACKAGES) {
        const raw = await readFile(resolve(root, pkg, "package.json"), "utf-8");
        const json = JSON.parse(raw);
        map.set(json.name, json.version);
    }
    return map;
}

/** Replace `workspace:*` in deps/peerDeps with resolved versions. Returns the original content for restore. */
async function patchWorkspaceRefs(pkgJsonPath: string, versionMap: Map<string, string>): Promise<string> {
    const original = await readFile(pkgJsonPath, "utf-8");
    const json: PackageJson = JSON.parse(original);

    const depFields = ["dependencies", "peerDependencies"] as const;
    let patched = false;

    for (const field of depFields) {
        const deps = json[field] as Record<string, string> | undefined;
        if (!deps) continue;

        for (const [name, range] of Object.entries(deps)) {
            if (range.startsWith("workspace:")) {
                const resolved = versionMap.get(name);
                if (!resolved) {
                    console.error(`Cannot resolve workspace reference: ${name}@${range}`);
                    process.exit(1);
                }
                deps[name] = resolved;
                patched = true;
            }
        }
    }

    if (patched) {
        await writeFile(pkgJsonPath, `${JSON.stringify(json, null, 4)}\n`);
        console.log(`  ✓ Patched workspace:* references in ${pkgJsonPath}`);
    }

    return original;
}

async function restoreFile(path: string, content: string): Promise<void> {
    await writeFile(path, content);
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

// 4. Build version map
const versionMap = await buildVersionMap();
console.log("\nVersion map:");
for (const [name, version] of versionMap) {
    console.log(`  ${name} → ${version}`);
}

// 5. Publish in dependency order
console.log("\nPublishing...\n");
for (const pkg of PACKAGES) {
    const cwd = resolve(root, pkg);
    const pkgJsonPath = resolve(cwd, "package.json");

    // Patch workspace:* → real versions
    const original = await patchWorkspaceRefs(pkgJsonPath, versionMap);

    try {
        const cmd = ["bun", "publish", "--access", "public"];
        if (dryRun) cmd.push("--dry-run");
        run(cmd, { cwd });
    } finally {
        // Always restore original package.json
        await restoreFile(pkgJsonPath, original);
        console.log(`  ✓ Restored ${pkgJsonPath}`);
    }

    console.log("");
}

console.log("Done!\n");
