import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type NodeOutputFormat = "es" | "cjs";

interface PackageJsonLike {
    type?: string;
}

/**
 * Mirrors Node package behavior:
 * - package.json "type": "module" => ESM output
 * - otherwise => CJS output
 */
export async function resolveNodeOutputFormat(root: string): Promise<NodeOutputFormat> {
    const pkgPath = resolve(root, "package.json");
    try {
        const raw = await readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(raw) as PackageJsonLike;
        return pkg.type === "module" ? "es" : "cjs";
    } catch {
        return "cjs";
    }
}

const MAIN_ENTRY_CANDIDATES = ["index.mjs", "index.cjs", "index.js"] as const;

/**
 * Find built main entry regardless of selected output format.
 */
export async function resolveMainEntryPath(mainOutDir: string): Promise<string> {
    for (const candidate of MAIN_ENTRY_CANDIDATES) {
        const fullPath = resolve(mainOutDir, candidate);
        if (await pathExists(fullPath)) return fullPath;
    }

    throw new Error(`Main entry not found in ${mainOutDir}. Expected one of: ${MAIN_ENTRY_CANDIDATES.join(", ")}`);
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}
