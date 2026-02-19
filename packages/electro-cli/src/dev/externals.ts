import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

interface PackageJsonLike {
    type?: string;
    main?: string;
    module?: string;
    exports?: unknown;
}

export interface ResolvedExternals {
    externals: (string | RegExp)[];
    /**
     * Dependency package names that are likely CommonJS and may need
     * interop rewrites when output format is ESM.
     */
    cjsInteropDeps: string[];
}

/**
 * Resolve externals for Node scope builds (main/preload).
 *
 * Auto-externalizes: electron, Node builtins (bare + node: prefixed),
 * package.json dependencies + optionalDependencies, and deep imports (pkg/subpath).
 */
export async function resolveExternals(root: string): Promise<ResolvedExternals> {
    const pkgPath = resolve(root, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

    const deps = new Set<string>([
        "electron",
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
    ]);

    // @cordy/electro must be bundled — it relies on compile-time `define` replacements
    deps.delete("@cordy/electro");

    // Node builtins: both bare (fs) and prefixed (node:fs)
    const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);

    const depsArray = [...deps];
    const cjsInteropDeps = (
        await Promise.all(
            depsArray.map(async (dep) => ({
                dep,
                isCommonJs: await isLikelyCommonJsDependency(root, dep),
            })),
        )
    )
        .filter((entry) => entry.isCommonJs)
        .map((entry) => entry.dep);

    // Deep import pattern: externalize pkg/subpath for all deps
    const deepPattern = depsArray.length > 0 ? new RegExp(`^(${depsArray.map(escapeRegExp).join("|")})/.+`) : null;

    return {
        externals: deepPattern ? [...depsArray, ...builtins, deepPattern] : [...depsArray, ...builtins],
        cjsInteropDeps,
    };
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function isLikelyCommonJsDependency(root: string, dep: string): Promise<boolean> {
    // Builtins/electron do not need this rewrite.
    if (dep === "electron" || dep.startsWith("node:")) return false;

    const depPkgPath = resolve(root, "node_modules", dep, "package.json");
    try {
        const depPkg = JSON.parse(await readFile(depPkgPath, "utf-8")) as PackageJsonLike;
        return !isLikelyEsmPackage(depPkg);
    } catch {
        // If metadata is unavailable (pnpm hoist edge cases, optional dep),
        // do not force interop rewrite.
        return false;
    }
}

function isLikelyEsmPackage(pkg: PackageJsonLike): boolean {
    if (pkg.type === "module") return true;
    if (typeof pkg.module === "string") return true;
    if (typeof pkg.main === "string" && pkg.main.endsWith(".mjs")) return true;
    if (typeof pkg.exports === "string" && pkg.exports.endsWith(".mjs")) return true;
    if (hasImportCondition(pkg.exports)) return true;
    return false;
}

function hasImportCondition(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) {
        return value.some(hasImportCondition);
    }

    const record = value as Record<string, unknown>;
    if ("import" in record) return true;

    for (const nested of Object.values(record)) {
        if (hasImportCondition(nested)) return true;
    }
    return false;
}
