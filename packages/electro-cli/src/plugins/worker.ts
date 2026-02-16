import MagicString from "magic-string";
import type { Plugin } from "vite";
import { cleanUrl, toRelativePath } from "./utils";

const WORKER_PLACEHOLDER_RE = /__ELECTRO_WORKER__([\w$]+)__/g;
const WORKER_QUERY_RE = /\?nodeWorker(?:&|$)/;
const WORKER_IMPORTER_RE = /\?nodeWorker&importer=([^&]+)(?:&|$)/;

/**
 * Handles `?nodeWorker` imports in main/preload scopes.
 *
 * Builds the referenced file as a separate chunk and returns
 * a factory function that creates a `worker_threads` Worker.
 *
 * Usage:
 *   import createWorker from './heavy-task.ts?nodeWorker'
 *   const worker = createWorker({ workerData: { ... } })
 */
export function workerPlugin(): Plugin {
    return {
        name: "electro:worker",
        apply: "build",
        enforce: "pre",

        resolveId(id, importer): string | undefined {
            if (id.endsWith("?nodeWorker")) {
                return `${id}&importer=${importer}`;
            }
        },

        load(id): string | undefined {
            if (!WORKER_QUERY_RE.test(id)) return;

            const match = WORKER_IMPORTER_RE.exec(id);
            if (!match) return;

            const refId = this.emitFile({
                type: "chunk",
                id: cleanUrl(id),
                importer: match[1],
            });

            const assetRef = `__ELECTRO_WORKER__${refId}__`;
            return [
                `import { Worker } from 'worker_threads';`,
                `export default function createWorker(options) {`,
                `  return new Worker(new URL(${assetRef}, import.meta.url), options);`,
                `};`,
            ].join("\n");
        },

        renderChunk(code, chunk, opts) {
            WORKER_PLACEHOLDER_RE.lastIndex = 0;
            let match = WORKER_PLACEHOLDER_RE.exec(code);
            if (!match) return null;

            const sourcemap = typeof opts === "object" && "sourcemap" in opts ? opts.sourcemap : false;
            const s = new MagicString(code);

            while (match) {
                const [full, hash] = match;
                const filename = this.getFileName(hash);
                const replacement = JSON.stringify(toRelativePath(chunk.fileName, filename));
                s.overwrite(match.index, match.index + full.length, replacement, { contentOnly: true });
                match = WORKER_PLACEHOLDER_RE.exec(code);
            }

            return {
                code: s.toString(),
                map: sourcemap ? s.generateMap({ hires: "boundary" }) : null,
            };
        },
    };
}
