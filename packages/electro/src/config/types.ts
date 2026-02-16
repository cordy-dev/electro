import type { UserConfig as ViteUserConfig } from "vite";

// ── Brand symbols (type-level only) ────────────────────────────────

declare const RUNTIME_BRAND: unique symbol;
declare const WINDOW_BRAND: unique symbol;
declare const CONFIG_BRAND: unique symbol;

// ── Value types ────────────────────────────────────────────────────

export type WindowLifecycle = "singleton" | "multi";
export type WindowCloseBehavior = "hide" | "destroy";
export type WindowType = "base-window" | "browser-window";

export interface WindowBehavior {
    close: WindowCloseBehavior;
}

// ── Branded definition types ───────────────────────────────────────

export interface RuntimeDefinition {
    readonly [RUNTIME_BRAND]: true;
    readonly entry: string;
    readonly vite?: ViteUserConfig;
    /** @internal Caller path captured by defineRuntime(). */
    readonly __source: string;
}

export interface WindowDefinition {
    readonly [WINDOW_BRAND]: true;
    readonly name: string;
    readonly entry: string;
    readonly type?: WindowType;
    readonly features?: readonly string[];
    readonly vite?: ViteUserConfig;
    readonly preload?: string;
    readonly lifecycle?: WindowLifecycle;
    readonly autoShow?: boolean;
    readonly behavior?: WindowBehavior;
    readonly window?: Record<string, unknown>;
    /** @internal Caller path captured by defineWindow(). */
    readonly __source: string;
}

export interface ElectroConfig {
    readonly [CONFIG_BRAND]: true;
    readonly runtime: RuntimeDefinition;
    readonly windows?: readonly WindowDefinition[];
}

// ── Input types (what users pass to define*() helpers) ─────────────

export interface DefineRuntimeInput {
    entry: string;
    vite?: ViteUserConfig;
}

export interface DefineWindowInput {
    name: string;
    entry: string;
    type?: WindowType;
    features?: readonly string[];
    vite?: ViteUserConfig;
    preload?: string;
    lifecycle?: WindowLifecycle;
    autoShow?: boolean;
    behavior?: WindowBehavior;
    window?: Record<string, unknown>;
}

export interface DefineConfigInput {
    runtime: RuntimeDefinition;
    windows?: readonly WindowDefinition[];
}
