import MagicString from "magic-string";
import type { Plugin } from "vite";

const STATIC_IMPORT_RE =
    /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\s'](?=\s*'))\s*["'][\s;]*/gmu;

interface NamedImport {
    imported: string;
    local: string;
}

interface ParsedImport {
    defaultImport?: string;
    named: NamedImport[];
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * Rewrites named imports from external CommonJS deps to runtime-safe accessors.
 *
 * Example:
 *   import { autoUpdater } from "electron-updater"
 * becomes
 *   import * as __cjs_ext_0__ from "electron-updater"
 *   const autoUpdater = __cjs_ext_0__.autoUpdater ?? __cjs_ext_0__.default?.autoUpdater
 */
export function cjsExternalInteropPlugin(cjsDeps: readonly string[]): Plugin {
    if (cjsDeps.length === 0) {
        return {
            name: "electro:cjs-external-interop",
            apply: "build",
        };
    }

    const cjsDepSet = new Set(cjsDeps);

    return {
        name: "electro:cjs-external-interop",
        apply: "build",
        enforce: "post",
        renderChunk(code, _chunk, { format, sourcemap }) {
            if (format !== "es") return null;

            let s: MagicString | null = null;
            let counter = 0;

            for (const match of code.matchAll(STATIC_IMPORT_RE)) {
                const statement = match[0];
                const start = match.index ?? 0;
                const specifier = match.groups?.specifier?.trim();
                const importsClause = match.groups?.imports?.trim();
                if (!specifier || !importsClause) continue;
                if (!isCjsExternalSpecifier(specifier, cjsDepSet)) continue;

                const parsed = parseImportClause(importsClause);
                if (!parsed) continue;

                const ns = `__cjs_ext_${counter++}__`;
                const lines: string[] = [`import * as ${ns} from ${JSON.stringify(specifier)};`];

                if (parsed.defaultImport) {
                    lines.push(`const ${parsed.defaultImport} = ${ns}.default ?? ${ns};`);
                }

                for (const { imported, local } of parsed.named) {
                    lines.push(`const ${local} = ${ns}.${imported} ?? ${ns}.default?.${imported};`);
                }

                s ??= new MagicString(code);
                s.overwrite(start, start + statement.length, lines.join("\n"));
            }

            if (!s) return null;

            return {
                code: s.toString(),
                map: sourcemap ? s.generateMap({ hires: "boundary" }) : null,
            };
        },
    };
}

function isCjsExternalSpecifier(specifier: string, cjsDepSet: Set<string>): boolean {
    if (
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        specifier.startsWith("\0") ||
        specifier.startsWith("node:")
    ) {
        return false;
    }

    if (cjsDepSet.has(specifier)) return true;

    for (const dep of cjsDepSet) {
        if (specifier.startsWith(`${dep}/`)) return true;
    }

    return false;
}

function parseImportClause(clause: string): ParsedImport | null {
    const braceStart = clause.indexOf("{");
    const braceEnd = clause.lastIndexOf("}");
    if (braceStart < 0 || braceEnd < braceStart) return null;

    const defaultPart = clause.slice(0, braceStart).trim().replace(/,$/, "").trim();
    if (defaultPart.startsWith("*")) return null;

    let defaultImport: string | undefined;
    if (defaultPart.length > 0) {
        const normalized = defaultPart.replace(/^type\s+/, "").trim();
        if (!IDENT_RE.test(normalized)) return null;
        defaultImport = normalized;
    }

    const namedPart = clause.slice(braceStart + 1, braceEnd).trim();
    if (namedPart.length === 0) return null;

    const named: NamedImport[] = [];
    for (const raw of namedPart.split(",")) {
        const token = raw.trim();
        if (token.length === 0) continue;

        const normalized = token.replace(/^type\s+/, "").trim();
        const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(normalized);
        if (!match) return null;

        named.push({
            imported: match[1],
            local: match[2] ?? match[1],
        });
    }

    if (named.length === 0) return null;
    return { defaultImport, named };
}
