#!/usr/bin/env bun

/**
 * Release script — bumps version in all packages, creates git commit and tag.
 *
 * Usage:
 *   bun scripts/release.ts <version>
 *   bun scripts/release.ts patch | minor | major
 *   bun scripts/release.ts 1.2.3
 *
 * Options:
 *   --dry-run   Print what would happen without making changes
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const PACKAGES = [
    "packages/electro/package.json",
    "packages/electro-generator/package.json",
    "packages/electro-cli/package.json",
] as const;

type BumpType = "patch" | "minor" | "major";

function bumpVersion(current: string, bump: BumpType): string {
    const [major, minor, patch] = current.split(".").map(Number);
    switch (bump) {
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
            return `${major}.${minor}.${patch + 1}`;
    }
}

function isValidSemver(v: string): boolean {
    return /^\d+\.\d+\.\d+$/.test(v);
}

async function readPkg(rel: string): Promise<{ path: string; json: Record<string, unknown> }> {
    const path = resolve(root, rel);
    const json = JSON.parse(await readFile(path, "utf-8"));
    return { path, json };
}

async function writePkg(path: string, json: Record<string, unknown>): Promise<void> {
    await writeFile(path, `${JSON.stringify(json, null, 4)}\n`);
}

function exec(cmd: string[], dryRun: boolean): void {
    if (dryRun) {
        console.log(`  [dry-run] ${cmd.join(" ")}`);
        return;
    }
    const result = Bun.spawnSync(cmd, { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
    if (result.exitCode !== 0) {
        console.error(`Command failed: ${cmd.join(" ")}`);
        process.exit(1);
    }
}

// ── Main ──

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const versionArg = args.find((a) => a !== "--dry-run");

if (!versionArg) {
    console.error("Usage: bun scripts/release.ts <patch|minor|major|x.y.z> [--dry-run]");
    process.exit(1);
}

// Determine next version
const firstPkg = await readPkg(PACKAGES[0]);
const currentVersion = firstPkg.json.version as string;

let nextVersion: string;
if (["patch", "minor", "major"].includes(versionArg)) {
    nextVersion = bumpVersion(currentVersion, versionArg as BumpType);
} else if (isValidSemver(versionArg)) {
    nextVersion = versionArg;
} else {
    console.error(`Invalid version: "${versionArg}". Use patch, minor, major, or a semver like 1.2.3`);
    process.exit(1);
}

console.log(`\nReleasing: ${currentVersion} → ${nextVersion}${dryRun ? " (dry run)" : ""}\n`);

// Update all package.json files
for (const rel of PACKAGES) {
    const { path, json } = await readPkg(rel);
    json.version = nextVersion;
    if (!dryRun) {
        await writePkg(path, json);
    }
    console.log(`  ✓ ${rel}`);
}

// Git commit + tag
console.log("");
exec(["git", "add", ...PACKAGES.map((p) => resolve(root, p))], dryRun);
exec(["git", "commit", "-m", `release: v${nextVersion}`], dryRun);
exec(["git", "tag", `v${nextVersion}`], dryRun);

console.log(`\nDone! To publish:\n  git push && git push --tags\n  bun run publish:packages\n`);
