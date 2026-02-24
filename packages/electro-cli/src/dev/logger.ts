import { basename, relative } from "node:path";
import type { Logger, LogLevel as ViteLogLevel } from "vite";
import { createLogger as viteCreateLogger } from "vite";

// ── ANSI constants ──────────────────────────────────────────────────

const yellow = "\x1b[33m";
const green = "\x1b[32m";
const cyan = "\x1b[36m";
const red = "\x1b[31m";
const magenta = "\x1b[35m";
const dim = "\x1b[90m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";

// ── Log level gating ────────────────────────────────────────────────

export type LogLevel = "info" | "warn" | "error" | "silent";

const levels: Record<LogLevel, number> = { info: 0, warn: 1, error: 2, silent: 3 };

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return currentLevel;
}

// ── Basic log functions ─────────────────────────────────────────────

export function info(msg: string): void {
    if (levels[currentLevel] > levels.info) return;
    console.log(`  ${dim}▸${reset} ${msg}`);
}

export function warn(msg: string): void {
    if (levels[currentLevel] > levels.warn) return;
    console.log(`  ${yellow}⚠ ${msg}${reset}`);
}

export function error(msg: string): void {
    if (levels[currentLevel] > levels.error) return;
    console.error(`  ${red}✗ ${msg}${reset}`);
}

export function note(msg: string): void {
    if (levels[currentLevel] > levels.info) return;
    console.log(`    ${dim}${msg}${reset}`);
}

// ── Timer ───────────────────────────────────────────────────────────

export function startTimer(): () => string {
    const startedAt = Date.now();
    return () => formatDuration(Date.now() - startedAt);
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60)
        .toString()
        .padStart(2, "0");
    return `${minutes}m${rest}s`;
}

// ── Step output with dot-leaders ────────────────────────────────────

const STEP_WIDTH = 26;

export function step(label: string, duration: string, extra?: string): void {
    if (levels[currentLevel] > levels.info) return;
    const dotsLen = Math.max(2, STEP_WIDTH - label.length - 1);
    const dots = "·".repeat(dotsLen);
    const dur = duration.padStart(5);
    const suffix = extra ? `  ${dim}${extra}${reset}` : "";
    console.log(`  ${label} ${dim}${dots}${reset} ${green}✓${reset} ${green}${dur}${reset}${suffix}`);
}

export function stepFail(label: string, message: string): void {
    const dotsLen = Math.max(2, STEP_WIDTH - label.length - 1);
    const dots = "·".repeat(dotsLen);
    console.error(`  ${label} ${dim}${dots}${reset} ${red}✗ ${message}${reset}`);
}

// ── Runtime event log (Vite-style with timestamp) ───────────────────

function colorRuntimeMessage(msg: string): string {
    if (msg.startsWith("hmr update")) return `${green}${msg}${reset}`;
    if (msg.startsWith("page reload")) return `${yellow}page reload${reset}${msg.slice("page reload".length)}`;
    if (msg.startsWith("rebuild")) return `${cyan}rebuild${reset}${msg.slice("rebuild".length)}`;
    if (msg.startsWith("generated")) return `${magenta}generated${reset}`;
    if (msg.startsWith("crashed")) return `${red}${msg}${reset}`;
    if (msg.startsWith("exited")) return `${dim}exited${reset}`;
    return msg;
}

function formatTime(d: Date): string {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function clearProgressLine(): void {
    if (process.stdout.isTTY) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
    }
}

export function runtimeLog(scope: string, msg: string, changedFile?: string | null): void {
    if (levels[currentLevel] > levels.info) return;
    clearProgressLine();
    const time = formatTime(new Date());
    const filePart = changedFile ? ` ${dim}${changedFile}${reset}` : "";
    console.log(
        `${dim}${time}${reset} ${yellow}[electro]${reset} ${dim}(${scope})${reset} ${colorRuntimeMessage(msg)}${filePart}`,
    );
}

// ── Footer ──────────────────────────────────────────────────────────

export function footer(message: string, url?: string): void {
    if (levels[currentLevel] > levels.info) return;
    console.log(`\n  ${bold}${green}✓ ${message}${reset}`);
    if (url) {
        console.log(`    ${yellow}→ ${url}${reset}`);
    }
    console.log("");
}

// ── Session header ──────────────────────────────────────────────────

export interface SessionMeta {
    root: string;
    runtime: string;
    preload: string | null;
    /** "dev" (default) or "build" */
    mode?: "dev" | "build";
    views?: Array<{
        name: string;
        root: string;
        entry: string;
    }>;
}

function toProjectRelative(root: string, absolutePath: string): string {
    const rel = relative(root, absolutePath);
    return rel || ".";
}

export function logSession(meta: SessionMeta): void {
    if (levels[currentLevel] > levels.info) return;

    const isBuild = meta.mode === "build";
    const projectName = basename(meta.root);

    const runtimeEntry = toProjectRelative(meta.root, meta.runtime);
    const preloadEntry = meta.preload ? toProjectRelative(meta.root, meta.preload) : `${dim}(none)${reset}`;

    const firstView = meta.views?.[0] ?? null;
    const viewEntry = firstView ? toProjectRelative(meta.root, firstView.entry) : `${dim}(none)${reset}`;

    const command = isBuild ? "build" : "dev";
    console.log(`\n${bold}${yellow}⚡ electro ${command}${reset} → ${cyan}${projectName}${reset}\n`);

    const runtimeMode = isBuild ? "build" : "watch";
    const preloadMode = isBuild ? "build" : "watch";
    const viewsMode = isBuild ? "build" : "dev server";

    const rows = [
        {
            scope: `${cyan}runtime${reset}`,
            entry: runtimeEntry,
            mode: `${dim}${runtimeMode}${reset}`,
        },
        {
            scope: `${yellow}preload${reset}`,
            entry: preloadEntry,
            mode: `${dim}${preloadMode}${reset}`,
        },
        {
            scope: `${green}view${reset}`,
            entry: viewEntry,
            mode: `${dim}${viewsMode}${reset}`,
        },
    ];

    const scopeWidth = Math.max("Scope".length, ...rows.map((r) => visibleLength(r.scope))) + 2;
    const entryWidth = Math.max("Entry".length, ...rows.map((r) => visibleLength(r.entry))) + 2;

    console.log(`  ${dim}${padVisible("Scope", scopeWidth)}${padVisible("Entry", entryWidth)}Mode${reset}`);

    for (const row of rows) {
        console.log(`  ${padVisible(row.scope, scopeWidth)}${padVisible(row.entry, entryWidth)}${row.mode}`);
    }

    if (meta.views && meta.views.length > 0) {
        console.log("");
        console.log(`  ${dim}Views${reset}    ${meta.views.length} configured`);

        const viewNameWidth = Math.max(4, ...meta.views.map((v) => v.name.length)) + 2;

        for (const view of meta.views) {
            const entry = toProjectRelative(meta.root, view.entry);
            console.log(`  ${padVisible(view.name, viewNameWidth)}${dim}${entry}${reset}`);
        }
    }

    console.log("");
}

// ── Vite logger patching ────────────────────────────────────────────

// biome-ignore lint/complexity/useRegexLiterals: ANSI escape sequences need String.raw
const ANSI_RE = new RegExp(String.raw`\x1b\[[0-9;]*m`, "g");
// biome-ignore lint/complexity/useRegexLiterals: ANSI escape sequences need String.raw
const VITE_TAG_RE = new RegExp(String.raw`(?:\x1b\[[0-9;]*m)*\[(vite(?:-plugin-[^\]]+)?)\](?:\x1b\[[0-9;]*m)*`, "g");

function retagMessage(msg: string): string {
    return msg.replace(VITE_TAG_RE, `[${bold}${yellow}electro${reset}]`);
}

function visibleLength(value: string): number {
    return value.replace(ANSI_RE, "").length;
}

function padVisible(value: string, width: number): string {
    const len = visibleLength(value);
    return value + " ".repeat(Math.max(0, width - len));
}

/**
 * Patch a Vite logger to rebrand `[vite]` → `[electro]`,
 * suppress startup noise ("ready in", "➜"), and extract
 * HMR/reload targets for cleaner output.
 */
export function patchLogger(logger: Logger, scope: string): void {
    const origInfo = logger.info.bind(logger);
    logger.info = (msg: string, options?: { timestamp?: boolean }) => {
        if (typeof msg !== "string") return origInfo(msg, options);
        const clean = msg.replace(ANSI_RE, "").trim();

        // Suppress Vite startup noise — we print our own banner.
        if (!clean || clean.includes("ready in") || clean.includes("➜")) return;

        if (clean.includes("hmr update")) {
            const target = extractTarget(clean, "hmr update");
            runtimeLog(scope, `hmr update${target ? ` ${target}` : ""}`);
            return;
        }

        if (clean.includes("hmr invalidate")) {
            const target = extractTarget(clean, "hmr invalidate");
            runtimeLog(scope, `hmr invalidate${target ? ` ${target}` : ""}`);
            return;
        }

        if (clean.includes("page reload")) {
            const target = extractTarget(clean, "page reload");
            runtimeLog(scope, `page reload${target ? ` ${target}` : ""}`);
            return;
        }

        origInfo(retagMessage(msg), options);
    };

    const origWarn = logger.warn.bind(logger);
    logger.warn = (msg: string, options?: { timestamp?: boolean }) => {
        if (typeof msg !== "string") return origWarn(msg, options);
        origWarn(retagMessage(msg), options);
    };

    const origError = logger.error.bind(logger);
    logger.error = (msg: string, options?: { timestamp?: boolean }) => {
        if (typeof msg !== "string") return origError(msg, options);
        origError(retagMessage(msg), options);
    };
}

function extractTarget(message: string, event: string): string | null {
    const match = message.match(new RegExp(`\\b${event}\\b\\s+(.+)$`));
    return match?.[1]?.trim() ?? null;
}

/**
 * Create a Vite customLogger config for a given scope.
 * Returns `undefined` if no scope-specific logger is needed
 * (caller can still use patchLogger on the created server's logger).
 */
export function createLoggerConfig(_scope: string): { logLevel: ViteLogLevel } | undefined {
    // For now, we only use patchLogger post-creation.
    // This is a placeholder for future per-scope log level overrides.
    return undefined;
}

// ── Build-mode logger ──────────────────────────────────────────────

/** Print a scope header before a production build step. */
export function buildScope(scope: string): void {
    if (levels[currentLevel] > levels.info) return;
    const color = scope === "main" ? cyan : scope === "preload" ? yellow : green;
    console.log(`\n  ${color}${scope}${reset}`);
}

/**
 * Create a Vite Logger for production builds.
 * Suppresses the "vite vX building..." header (we print our own banner)
 * and rebrands `[vite]` → `[electro]`. Everything else — transforming
 * progress, file listing with sizes, "built in" — passes through.
 */
export function createBuildLogger(): Logger {
    const logger = viteCreateLogger(currentLevel, { allowClearScreen: false });

    const origInfo = logger.info.bind(logger);
    logger.info = (msg: string, options?: { timestamp?: boolean }) => {
        if (typeof msg !== "string") return origInfo(msg, options);
        const clean = msg.replace(ANSI_RE, "").trim();

        // Suppress Vite's build header — we print our own banner
        if (/^vite v[\d.]+/.test(clean) && clean.includes("building")) return;

        if (!clean) return;

        origInfo(retagMessage(msg), options);
    };

    const origWarn = logger.warn.bind(logger);
    logger.warn = (msg: string, options?: { timestamp?: boolean }) => {
        if (typeof msg !== "string") return origWarn(msg, options);
        origWarn(retagMessage(msg), options);
    };

    const origError = logger.error.bind(logger);
    logger.error = (msg: string, options?: { timestamp?: boolean }) => {
        if (typeof msg !== "string") return origError(msg, options);
        origError(retagMessage(msg), options);
    };

    return logger;
}
