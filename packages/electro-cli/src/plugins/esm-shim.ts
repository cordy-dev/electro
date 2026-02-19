import MagicString from "magic-string";
import type { Plugin } from "vite";

const CJSYNTAX_RE = /__filename|__dirname|require\(|require\.resolve\(/;

const CJS_SHIM = `
// -- CommonJS Shims --
import __cjs_url__ from "node:url";
import __cjs_path__ from "node:path";
import __cjs_mod__ from "node:module";
const __filename = __cjs_url__.fileURLToPath(import.meta.url);
const __dirname = __cjs_path__.dirname(__filename);
const require = __cjs_mod__.createRequire(import.meta.url);
`;

const ESM_STATIC_IMPORT_RE =
    /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\s'](?=\s*'))\s*["'][\s;]*/gmu;

interface StaticImport {
    end: number;
}

function findStaticImports(code: string): StaticImport[] {
    const matches: StaticImport[] = [];
    for (const match of code.matchAll(ESM_STATIC_IMPORT_RE)) {
        matches.push({ end: (match.index || 0) + match[0].length });
    }
    return matches;
}

/**
 * Inject CommonJS shims into ESM output when bundled code contains
 * require/__dirname/__filename references.
 */
export function esmShimPlugin(): Plugin {
    return {
        name: "electro:esm-shim",
        apply: "build",
        enforce: "post",
        renderChunk(code, _chunk, { format, sourcemap }) {
            if (format !== "es") return null;
            if (code.includes(CJS_SHIM) || !CJSYNTAX_RE.test(code)) return null;

            const lastImport = findStaticImports(code).pop();
            const indexToAppend = lastImport ? lastImport.end : 0;
            const s = new MagicString(code);
            s.appendRight(indexToAppend, CJS_SHIM);

            return {
                code: s.toString(),
                map: sourcemap ? s.generateMap({ hires: "boundary" }) : null,
            };
        },
    };
}
