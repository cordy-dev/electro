import type { UserConfig as ViteUserConfig } from "vite";
import type { FeatureMap } from "../core/types";

// ── Brand symbols (type-level only) ────────────────────────────────

declare const RUNTIME_BRAND: unique symbol;
declare const VIEW_BRAND: unique symbol;
declare const CONFIG_BRAND: unique symbol;

// ── Branded definition types ───────────────────────────────────────

export interface RuntimeDefinition {
    readonly [RUNTIME_BRAND]: true;
    readonly entry: string;
    readonly vite?: ViteUserConfig;
    /** @internal Caller path captured by defineRuntime(). */
    readonly __source: string;
}

export interface ViewDefinition {
    readonly [VIEW_BRAND]: true;
    readonly name: string;
    readonly entry?: string;
    readonly features?: readonly string[];
    readonly vite?: ViteUserConfig;
    readonly preload?: string;
    readonly webPreferences?: Record<string, unknown>;
    /** @internal Caller path captured by defineView(). */
    readonly __source: string;
}

export interface ElectroConfig {
    readonly [CONFIG_BRAND]: true;
    readonly runtime: RuntimeDefinition;
    readonly views?: readonly ViewDefinition[];
}

// ── Input types (what users pass to define*() helpers) ─────────────

export interface DefineRuntimeInput {
    entry: string;
    vite?: ViteUserConfig;
}

/** Suggests known feature IDs from FeatureMap while still allowing arbitrary strings. */
type SuggestFeatureId = (keyof FeatureMap & string) | (string & {});

export interface DefineViewInput {
    name: string;
    entry?: string;
    features?: readonly SuggestFeatureId[];
    vite?: ViteUserConfig;
    preload?: string;
    webPreferences?: Record<string, unknown>;
}

export interface DefineConfigInput {
    runtime: RuntimeDefinition;
    views?: readonly ViewDefinition[];
}
