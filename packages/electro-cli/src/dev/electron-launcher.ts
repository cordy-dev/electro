import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Find the Electron binary. Resolution order:
 * 1. ELECTRON_EXEC_PATH env var
 * 2. electron/path.txt (npm package convention)
 * 3. node_modules/.bin/electron symlink
 */
export async function findElectronBin(root: string): Promise<string> {
    // 1. Env var
    if (process.env.ELECTRON_EXEC_PATH) return process.env.ELECTRON_EXEC_PATH;

    // 2. electron/path.txt
    try {
        const electronDir = resolve(root, "node_modules/electron");
        const pathTxtPath = resolve(electronDir, "path.txt");
        if (await fileExists(pathTxtPath)) {
            const binPath = (await readFile(pathTxtPath, "utf-8")).trim();
            const resolved = resolve(electronDir, binPath);
            if (await fileExists(resolved)) return resolved;
        }
    } catch {
        // fall through
    }

    // 3. Symlink
    const binSymlink = resolve(root, "node_modules/.bin/electron");
    if (await fileExists(binSymlink)) return binSymlink;

    throw new Error("Could not find Electron binary. Install electron: npm add -D electron");
}

export interface ElectronLaunchOptions {
    /** Project root */
    root: string;
    /** Path to the built main entry (e.g. .electro/main/index.mjs or index.cjs) */
    entry: string;
    /** Environment variables to pass */
    env?: Record<string, string>;
}

export interface ManagedProcess {
    kill(): void;
    exited: Promise<number | null>;
}

// ── ANSI constants ──────────────────────────────────────────────────

const yellow = "\x1b[33m";
const red = "\x1b[31m";
const dim = "\x1b[90m";
const reset = "\x1b[0m";

// Match runtime diagnostic lines: "HH:MM:SS [tag] code → message"
// biome-ignore lint/complexity/useRegexLiterals: readability
const DIAG_RE = new RegExp(String.raw`^(\d{2}:\d{2}:\d{2}) \[(electro|warn|error)\] (.+?) \u2192 (.+)$`);

function colorDiagnosticLine(line: string): string {
    const match = line.match(DIAG_RE);
    if (!match) return line;

    const [, time, tag, code, message] = match;
    let coloredTag: string;

    if (tag === "error") {
        coloredTag = `${red}[${tag}]${reset}`;
    } else if (tag === "warn") {
        coloredTag = `${yellow}[${tag}]${reset}`;
    } else {
        coloredTag = `${yellow}[${tag}]${reset}`;
    }

    return `${dim}${time}${reset} ${coloredTag} ${dim}${code}${reset} \u2192 ${message}`;
}

function pipeWithColoring(stream: NodeJS.ReadableStream, target: NodeJS.WritableStream): void {
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            target.write(`${colorDiagnosticLine(line)}\n`);
        }
    });
    stream.on("end", () => {
        if (buffer) {
            target.write(`${colorDiagnosticLine(buffer)}\n`);
        }
    });
}

export async function launchElectron(opts: ElectronLaunchOptions): Promise<ManagedProcess> {
    const electronBin = await findElectronBin(opts.root);

    const proc = spawn(electronBin, [opts.entry], {
        cwd: opts.root,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...opts.env },
    });

    // Pipe stdout/stderr with diagnostic line coloring
    if (proc.stdout) pipeWithColoring(proc.stdout, process.stdout);
    if (proc.stderr) pipeWithColoring(proc.stderr, process.stderr);

    const exited = new Promise<number | null>((resolve) => {
        proc.on("exit", (code) => resolve(code));
        proc.on("error", () => resolve(null));
    });

    return {
        kill: () => proc.kill(),
        exited,
    };
}
