import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ElectroConfig } from "@cordy/electro";
import { error, warn } from "./dev/logger";

const VALID_SOURCEMAP_VALUES = ["linked", "inline", "external", "none"];
const MIN_VITE_MAJOR = 8;

// ── Config validation ──────────────────────────────────────────────

/**
 * Validate the loaded ElectroConfig for structural issues.
 * Exits on fatal problems, warns on non-fatal ones.
 */
export function validateConfig(config: ElectroConfig): void {
    // Runtime entry must exist
    const runtimeDir = dirname(config.runtime.__source);
    const mainEntry = resolve(runtimeDir, config.runtime.entry);
    if (!existsSync(mainEntry)) {
        error(`Main entry not found: ${mainEntry}`);
        process.exit(1);
    }

    const views = config.views ?? [];

    // Duplicate view names
    const names = new Set<string>();
    for (const view of views) {
        if (names.has(view.name)) {
            error(`Duplicate view name "${view.name}". View names must be unique.`);
            process.exit(1);
        }
        names.add(view.name);
    }

    // View entry files must exist
    for (const view of views) {
        const viewDir = dirname(view.__source);
        const viewEntry = resolve(viewDir, view.entry);
        if (!existsSync(viewEntry)) {
            error(`View "${view.name}" entry not found: ${viewEntry}`);
            process.exit(1);
        }
    }

    // Empty features array is suspicious
    for (const view of views) {
        if (view.features && view.features.length === 0) {
            warn(`View "${view.name}" has an empty features array — it won't have access to any services.`);
        }
    }
}

// ── Sourcemap validation ───────────────────────────────────────────

/** Validate --sourcemap CLI value. Warns on unrecognized values. */
export function validateSourcemap(value: string): void {
    if (!VALID_SOURCEMAP_VALUES.includes(value)) {
        warn(
            `Unknown --sourcemap value "${value}". ` +
                `Valid values: ${VALID_SOURCEMAP_VALUES.join(", ")}. Defaulting to "linked".`,
        );
    }
}

// ── Vite version validation ────────────────────────────────────────

// ── Merged Node config validation ─────────────────────────────────

/**
 * Validate merged Vite config for a Node scope (main/preload).
 * Called after mergeConfig but before the config is used.
 * Throws on invalid settings that would break electro invariants.
 */
export function validateMergedNodeConfig(
    config: { build?: Record<string, unknown>; ssr?: unknown },
    scope: string,
): void {
    const target = config.build?.target;
    if (target) {
        const targets = Array.isArray(target) ? target : [target];
        for (const t of targets) {
            if (typeof t === "string" && t !== "esnext") {
                throw new Error(
                    `[electro] ${scope}: invalid target "${t}". Electro requires target: "esnext" (Electron 40+). ` +
                        "Remove the target override from your config.",
                );
            }
        }
    }

    const rolldownOpts = config.build?.rolldownOptions;
    if (rolldownOpts && typeof rolldownOpts === "object" && !Array.isArray(rolldownOpts)) {
        const output = (rolldownOpts as Record<string, unknown>).output;
        if (output && typeof output === "object" && !Array.isArray(output)) {
            const fmt = (output as Record<string, unknown>).format;
            if (fmt && fmt !== "es" && fmt !== "cjs") {
                throw new Error(
                    `[electro] ${scope}: invalid output format "${fmt}". ` +
                        `Electro supports "es" and "cjs" for Node scopes. ` +
                        "Update build.rolldownOptions.output.format in your config.",
                );
            }
        }
    }

    // SSR must be enabled for Node scopes
    if (config.ssr === false || config.build?.ssr === false) {
        throw new Error(
            `[electro] ${scope}: SSR cannot be disabled in Node scopes. ` +
                "SSR mode is required for correct Node.js module resolution.",
        );
    }
}

/**
 * Enforce electro invariants after merge — normalization pass.
 * Silently corrects values that must be fixed for correct operation.
 * Called AFTER validateMergedNodeConfig (which throws on user errors).
 */
export function enforceMergedNodeConfig(config: Record<string, unknown>, _scope: string): void {
    const build = config.build as Record<string, unknown> | undefined;
    if (!build) return;

    // Enforce target: "esnext"
    if (build.target !== "esnext") {
        build.target = "esnext";
    }

    // Enforce SSR is enabled
    if (!build.ssr) {
        build.ssr = true;
    }
}

// ── Vite version validation ────────────────────────────────────────

/** Validate that installed Vite version is within the supported range. */
export function validateViteVersion(viteVersion: string): void {
    const majorRaw = viteVersion.split(".", 1)[0];
    const major = Number.parseInt(majorRaw ?? "", 10);

    if (!Number.isFinite(major) || major < MIN_VITE_MAJOR) {
        error(`Unsupported Vite version: ${viteVersion}. @cordy/electro requires Vite ${MIN_VITE_MAJOR}+.`);
        process.exit(1);
    }
}
