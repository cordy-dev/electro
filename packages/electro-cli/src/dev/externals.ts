import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

/**
 * Resolve externals for Node scope builds (main/preload).
 *
 * Auto-externalizes: electron, Node builtins (bare + node: prefixed),
 * package.json dependencies + optionalDependencies, and deep imports (pkg/subpath).
 */
export async function resolveExternals(root: string): Promise<(string | RegExp)[]> {
    const pkgPath = resolve(root, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

    const deps = new Set<string>([
        "electron",
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
    ]);

    // Node builtins: both bare (fs) and prefixed (node:fs)
    const builtins = builtinModules.flatMap((m) => [m, `node:${m}`]);

    const depsArray = [...deps];

    // Deep import pattern: externalize pkg/subpath for all deps
    const deepPattern = depsArray.length > 0 ? new RegExp(`^(${depsArray.map(escapeRegExp).join("|")})/.+`) : null;

    return deepPattern ? [...depsArray, ...builtins, deepPattern] : [...depsArray, ...builtins];
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
