import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import { cleanUrl, toRelativePath } from "./utils";

const ASSET_QUERY_RE = /[?&]asset(?:&|$)/;
const ASSET_IMPORT_RE = /(?:[?&]asset(?:&|$)|\.node$)/;
const ASSET_PLACEHOLDER_RE = /__ELECTRO_ASSET__([\w$]+)__/g;

export function assetPlugin(): Plugin {
    const assetCache = new Map<string, string>();

    return {
        name: "electro:asset",
        apply: "build",

        async load(id) {
            if (id.startsWith("\0") || !ASSET_IMPORT_RE.test(id)) return;

            const file = cleanUrl(id);
            let referenceId: string;

            const cached = assetCache.get(file);
            if (cached) {
                referenceId = cached;
            } else {
                const source = await readFile(file);
                const hash = this.emitFile({
                    type: "asset",
                    name: basename(file),
                    source,
                });
                referenceId = `__ELECTRO_ASSET__${hash}__`;
                assetCache.set(file, referenceId);
            }

            if (ASSET_QUERY_RE.test(id)) {
                return [
                    `import { join } from "node:path"`,
                    `export default join(import.meta.dirname, ${referenceId})`,
                ].join("\n");
            }

            if (id.endsWith(".node")) {
                return [
                    `const __require = process.getBuiltinModule("module").createRequire(import.meta.url)`,
                    `export default __require(new URL(${referenceId}, import.meta.url).pathname)`,
                ].join("\n");
            }
        },

        renderChunk(code, chunk) {
            ASSET_PLACEHOLDER_RE.lastIndex = 0;
            let match = ASSET_PLACEHOLDER_RE.exec(code);
            if (!match) return null;

            const s = new MagicString(code);

            while (match) {
                const [full, hash] = match;
                const filename = this.getFileName(hash);
                const replacement = JSON.stringify(toRelativePath(chunk.fileName, filename));
                s.overwrite(match.index, match.index + full.length, replacement, {
                    contentOnly: true,
                });
                match = ASSET_PLACEHOLDER_RE.exec(code);
            }

            return {
                code: s.toString(),
                map: s.generateMap({ hires: "boundary" }),
            };
        },
    };
}
