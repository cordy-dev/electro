import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import MagicString from "magic-string";
import type { Logger, Plugin } from "vite";
import { findElectronBin } from "../dev/electron-launcher";

const BYTECODE_LOADER_FILE = "bytecode-loader.cjs";

export interface BytecodeOptions {
    /** Only compile chunks matching these names. Empty = compile all entry chunks. */
    chunkAlias?: string[];
    /** Keep original JS source alongside compiled .jsc for debugging. */
    keepSource?: boolean;
    /** String literals to obfuscate via String.fromCharCode before compilation. */
    protectedStrings?: string[];
}

/**
 * CJS module that registers `.jsc` file extension handler.
 * Loaded at runtime via createRequire before bytecode modules are required.
 */
const BYTECODE_LOADER_CODE = [
    `"use strict";`,
    `const fs = require("fs");`,
    `const path = require("path");`,
    `const vm = require("vm");`,
    `const v8 = require("v8");`,
    `const Module = require("module");`,
    ``,
    `v8.setFlagsFromString("--no-lazy");`,
    `v8.setFlagsFromString("--no-flush-bytecode");`,
    ``,
    `const FLAG_HASH_OFFSET = 12;`,
    `const SOURCE_HASH_OFFSET = 8;`,
    ``,
    `let dummyBytecode;`,
    `function fixFlagHash(buffer) {`,
    `  if (!dummyBytecode) {`,
    `    dummyBytecode = new vm.Script("", { produceCachedData: true }).createCachedData();`,
    `  }`,
    `  dummyBytecode.copy(buffer, FLAG_HASH_OFFSET, FLAG_HASH_OFFSET, FLAG_HASH_OFFSET + 4);`,
    `}`,
    ``,
    `Module._extensions[".jsc"] = function(module, filename) {`,
    `  const bytecode = fs.readFileSync(filename);`,
    `  fixFlagHash(bytecode);`,
    `  const sourceLength = bytecode.readUInt32LE(SOURCE_HASH_OFFSET);`,
    `  const dummyCode = sourceLength > 1 ? '"' + "\\u200b".repeat(sourceLength - 2) + '"' : "";`,
    `  const script = new vm.Script(dummyCode, { filename, cachedData: bytecode });`,
    `  if (script.cachedDataRejected) {`,
    `    throw new Error("Bytecode cache rejected (V8 version mismatch?): " + filename);`,
    `  }`,
    `  const wrapper = script.runInThisContext({ filename });`,
    `  const dir = path.dirname(filename);`,
    `  wrapper.apply(module.exports, [module.exports, module.require.bind(module), module, filename, dir]);`,
    `};`,
    ``,
].join("\n");

/**
 * Script executed inside Electron (ELECTRON_RUN_AS_NODE=1) to compile JS to V8 bytecode.
 * Reads CJS code from stdin, writes bytecode buffer to stdout.
 */
const COMPILER_SCRIPT = [
    `"use strict";`,
    `const vm = require("vm");`,
    `const v8 = require("v8");`,
    `const Module = require("module");`,
    ``,
    `v8.setFlagsFromString("--no-lazy");`,
    `v8.setFlagsFromString("--no-flush-bytecode");`,
    ``,
    `let code = "";`,
    `process.stdin.setEncoding("utf-8");`,
    `process.stdin.on("data", chunk => { code += chunk; });`,
    `process.stdin.on("end", () => {`,
    `  const wrapped = Module.wrap(code);`,
    `  const script = new vm.Script(wrapped, { produceCachedData: true });`,
    `  const bytecode = script.createCachedData();`,
    `  process.stdout.write(bytecode);`,
    `});`,
].join("\n");

/**
 * Compile Node scope output to V8 bytecode for source code protection.
 *
 * Architecture:
 * 1. ESM chunk code → CJS transform (via Bun.build)
 * 2. CJS code → V8 bytecode (via Electron subprocess)
 * 3. Entry .js → thin ESM loader stub that requires the .jsc bytecode
 * 4. bytecode-loader.cjs → registers Module._extensions[".jsc"]
 *
 * Only active in production mode. Not applicable to renderer scope.
 */
export function bytecodePlugin(options: BytecodeOptions = {}): Plugin {
    const { chunkAlias = [], keepSource = false, protectedStrings = [] } = options;
    const compileAll = chunkAlias.length === 0;
    const protectedSet = new Set(protectedStrings);

    let logger: Logger;
    let isProduction = false;
    let projectRoot = "";

    function shouldCompile(chunkName: string): boolean {
        return compileAll || chunkAlias.includes(chunkName);
    }

    return {
        name: "electro:bytecode",
        apply: "build",
        enforce: "post",

        configResolved(config): void {
            logger = config.logger;
            isProduction = config.isProduction;
            projectRoot = config.root;
        },

        renderChunk(code, chunk, opts) {
            if (!isProduction || !shouldCompile(chunk.name) || protectedSet.size === 0) return null;

            const s = obfuscateStrings(code, protectedSet);
            if (!s) return null;

            const sourcemap = typeof opts === "object" && "sourcemap" in opts ? opts.sourcemap : false;
            return {
                code: s.toString(),
                map: sourcemap ? s.generateMap({ hires: "boundary" }) : undefined,
            };
        },

        async generateBundle(_outputOptions, output): Promise<void> {
            if (!isProduction) return;

            // Resolve Electron binary (walk up to monorepo root if needed)
            let electronPath: string | undefined;
            try {
                electronPath = await findElectronBin(projectRoot);
            } catch {
                try {
                    electronPath = await findElectronBin(join(projectRoot, "../.."));
                } catch {
                    // not found
                }
            }

            if (!electronPath) {
                logger.warn("[electro:bytecode] Electron binary not found — skipping bytecode compilation");
                return;
            }

            // Write compiler script to temp dir
            const compilerPath = join(tmpdir(), `electro-bc-compiler-${process.pid}.cjs`);
            await Bun.write(compilerPath, COMPILER_SCRIPT);

            const chunks: Array<{ fileName: string; name: string; code: string; exports: string[]; isEntry: boolean }> =
                [];
            for (const item of Object.values(output)) {
                if (item.type === "chunk" && item.isEntry && shouldCompile(item.name)) {
                    chunks.push(item as (typeof chunks)[number]);
                }
            }

            if (chunks.length === 0) {
                await cleanup(compilerPath);
                return;
            }

            let compiledCount = 0;

            for (const chunk of chunks) {
                try {
                    // 1. Transform ESM → CJS
                    const cjsCode = await esmToCjs(chunk.code);

                    // 2. Compile CJS → V8 bytecode
                    const bytecode = await compileToBytecode(cjsCode, electronPath, compilerPath);

                    // 3. Emit .jsc bytecode file
                    const jscFileName = `${chunk.fileName}c`;
                    this.emitFile({ type: "asset", fileName: jscFileName, source: bytecode });

                    // 4. Optionally keep original source for debugging
                    if (keepSource) {
                        this.emitFile({ type: "asset", fileName: `_${chunk.fileName}`, source: chunk.code });
                    }

                    // 5. Replace entry code with ESM loader stub
                    const loaderRel = relativeChunkPath(BYTECODE_LOADER_FILE, chunk.fileName);
                    const jscRel = relativeChunkPath(jscFileName, chunk.fileName);
                    chunk.code = generateLoaderStub(loaderRel, jscRel, chunk.exports);

                    compiledCount++;
                } catch (e) {
                    logger.error(
                        `[electro:bytecode] Failed to compile ${chunk.fileName}: ${e instanceof Error ? e.message : e}`,
                    );
                }
            }

            // 6. Emit bytecode loader (once)
            if (compiledCount > 0) {
                const alreadyEmitted = Object.values(output).some(
                    (a) => a.type === "asset" && a.fileName === BYTECODE_LOADER_FILE,
                );
                if (!alreadyEmitted) {
                    this.emitFile({ type: "asset", fileName: BYTECODE_LOADER_FILE, source: BYTECODE_LOADER_CODE });
                }
                logger.info(`\x1b[32m\u2713\x1b[0m ${compiledCount} chunk(s) compiled to bytecode`);
            }

            await cleanup(compilerPath);
        },
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Transform ESM code to CJS using Bun.build (packages stay external). */
async function esmToCjs(code: string): Promise<string> {
    const tmpFile = join(tmpdir(), `electro-bc-${process.pid}-${Date.now()}.mjs`);
    await Bun.write(tmpFile, code);

    try {
        const result = await Bun.build({
            entrypoints: [tmpFile],
            format: "cjs",
            target: "node",
            packages: "external",
            minify: false,
        });

        if (!result.success) {
            const msgs = result.logs.map((l) => l.message).join("\n");
            throw new Error(`ESM\u2192CJS transform failed:\n${msgs}`);
        }

        return await result.outputs[0].text();
    } finally {
        await cleanup(tmpFile);
    }
}

/** Compile CJS code to V8 bytecode via Electron subprocess. */
async function compileToBytecode(code: string, electronPath: string, compilerPath: string): Promise<Buffer> {
    const proc = Bun.spawn([electronPath, compilerPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdin: new Blob([code]),
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdoutBuf, stderrText, exitCode] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);

    if (exitCode !== 0) {
        throw new Error(`Bytecode compilation failed (exit ${exitCode}): ${stderrText}`);
    }

    const buf = Buffer.from(stdoutBuf);
    if (buf.length === 0) {
        throw new Error("Bytecode compilation returned empty buffer");
    }

    return buf;
}

/** Generate ESM entry stub that loads bytecode via createRequire. */
function generateLoaderStub(loaderPath: string, jscPath: string, exports: string[]): string {
    const lines = [
        `const __require = process.getBuiltinModule("module").createRequire(import.meta.url);`,
        `__require(${JSON.stringify(loaderPath)});`,
        `const __mod = __require(${JSON.stringify(jscPath)});`,
    ];

    if (exports.includes("default")) {
        lines.push(`export default __mod["default"] ?? __mod;`);
    }

    const named = exports.filter((e) => e !== "default");
    if (named.length > 0) {
        lines.push(`export const { ${named.join(", ")} } = __mod;`);
    }

    return `${lines.join("\n")}\n`;
}

/**
 * Obfuscate specific string literals via String.fromCharCode.
 *
 * Context-aware: skips strings that appear in unsafe positions:
 * - import/export specifiers: `import "pkg"`, `from "pkg"`
 * - require() arguments: `require("pkg")`
 * - computed member expressions: `obj["key"]`
 * - object literal keys: `{ "key": value }`
 */
function obfuscateStrings(code: string, strings: Set<string>): MagicString | null {
    if (strings.size === 0) return null;

    let s: MagicString | undefined;

    // Match quoted strings: captures the quote char, content, and position
    const stringRE = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
    let match: RegExpExecArray | null;

    match = stringRE.exec(code);
    while (match) {
        const value = match[1] ?? match[2];
        if (value && strings.has(value) && !isUnsafeContext(code, match.index, match[0].length)) {
            s ??= new MagicString(code);
            const charCodes = Array.from(value)
                .map((c) => c.charCodeAt(0))
                .join(",");
            s.overwrite(match.index, match.index + match[0].length, `String.fromCharCode(${charCodes})`, {
                contentOnly: true,
            });
        }
        match = stringRE.exec(code);
    }

    return s ?? null;
}

/** Check if a string literal at the given position is in an unsafe context for obfuscation. */
function isUnsafeContext(code: string, matchStart: number, matchLen: number): boolean {
    // Look at the code before the string (skip whitespace)
    const before = code.slice(Math.max(0, matchStart - 80), matchStart).trimEnd();

    // import "pkg" / import '...' from "pkg" / export ... from "pkg"
    if (/\bimport\s*$/.test(before) || /\bfrom\s*$/.test(before)) return true;

    // require("pkg")
    if (/\brequire\s*\(\s*$/.test(before)) return true;

    // Computed member: obj["key"] — preceding `[` (possibly with whitespace)
    if (before.endsWith("[")) return true;

    // Look at code after the string
    const after = code.slice(matchStart + matchLen, matchStart + matchLen + 20).trimStart();

    // Object key: "key": value — string followed by `:`
    if (after.startsWith(":")) {
        // But not ternary — check if before looks like `?` or start of object/argument
        if (!before.endsWith("?")) return true;
    }

    return false;
}

/** Compute relative path from `from` file to `target` file. */
function relativeChunkPath(target: string, from: string): string {
    const fromDir = dirname(from);
    let rel = relative(fromDir, target);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return rel;
}

/** Silent cleanup of temp files. */
async function cleanup(filePath: string): Promise<void> {
    try {
        await Bun.file(filePath).delete();
    } catch {}
}
