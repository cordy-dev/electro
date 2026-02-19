import type { TaskHandle } from "./task/handle";
import type { ElectroView } from "./view/types";
import type { CreatedWindow } from "./window/types";

/**
 * Declaration-merging registry.
 * Codegen populates this via `declare module "@cordy/electro"`.
 *
 * Each key is a feature ID mapping to its services, tasks, and dependencies.
 */
export interface FeatureMap {}

/** Maps service ID → owning feature ID. Populated by codegen. */
export interface ServiceOwnerMap {}

/** Maps task ID → owning feature ID. Populated by codegen. */
export interface TaskOwnerMap {}

/** Declaration-merging registry for view types. Codegen populates this. */
export interface ViewMap {}

/** Declaration-merging registry for window API types. Codegen populates this. */
export interface WindowApiMap {}

/** Resolve the owning feature ID for a service. Falls back to `string` (→ BaseContext). */
export type _ServiceOwner<TId extends string> = TId extends keyof ServiceOwnerMap ? ServiceOwnerMap[TId] : string;

/** Resolve the owning feature ID for a task. Falls back to `string` (→ BaseContext). */
export type _TaskOwner<TId extends string> = TId extends keyof TaskOwnerMap ? TaskOwnerMap[TId] : string;

// ── View type resolution ────────────────────────────────────────────

type _SuggestViewKeys = (keyof ViewMap & string) | (string & {});

// ── Window type resolution ──────────────────────────────────────────

type _SuggestWindowKeys = (keyof WindowApiMap & string) | (string & {});
type _ResolveWindowApi<K extends string> = K extends keyof WindowApiMap ? WindowApiMap[K] : unknown;

// ── Per-feature type resolution ──────────────────────────────────────

/** Extract the dependency IDs union for a feature. */
type _DepIds<FId> = FId extends keyof FeatureMap ? FeatureMap[FId]["dependencies"] : never;

/** Own service keys for a feature. */
type _OwnSvcKeys<FId> = FId extends keyof FeatureMap ? keyof FeatureMap[FId]["services"] & string : never;

/** Distributive helper — maps a single dep ID to its qualified service keys. */
type _DepSvcOf<D> = D extends keyof FeatureMap & string ? `${D}:${keyof FeatureMap[D]["services"] & string}` : never;

/** Qualified dependency service keys ("dep:svc"), distributes over the deps union. */
type _DepSvcKeys<FId> = _DepSvcOf<_DepIds<FId>>;

/** Resolve a service type from own or dependency services. */
type _ResolveSvc<FId, K extends string> = FId extends keyof FeatureMap
    ? K extends keyof FeatureMap[FId]["services"]
        ? FeatureMap[FId]["services"][K]
        : K extends `${infer D}:${infer S}`
          ? D extends _DepIds<FId> & keyof FeatureMap
              ? S extends keyof FeatureMap[D]["services"]
                  ? FeatureMap[D]["services"][S]
                  : unknown
              : unknown
          : unknown
    : unknown;

/** Resolve a task type from own tasks. FeatureMap stores payloads; wraps in TaskHandle. */
type _ResolveTask<FId, K extends string> = FId extends keyof FeatureMap
    ? K extends keyof FeatureMap[FId]["tasks"]
        ? TaskHandle<FeatureMap[FId]["tasks"][K]>
        : unknown
    : unknown;

/** Resolve a feature handle from dependency features. */
type _ResolveFeature<FId, K extends string> = FId extends keyof FeatureMap
    ? K extends _DepIds<FId> & string
        ? import("./feature/handle").FeatureHandle
        : unknown
    : unknown;

// ── Suggest helpers (strict — only known keys) ──────────────────────

type _SuggestSvcKeys<FId> = _OwnSvcKeys<FId> | _DepSvcKeys<FId>;
type _SuggestTaskKeys<FId> = FId extends keyof FeatureMap ? keyof FeatureMap[FId]["tasks"] & string : never;
type _SuggestDepKeys<FId> = _DepIds<FId> & string;

// ── Event type helpers ──────────────────────────────────────────────

/** Own event keys for a feature. */
type _OwnEventKeys<FId> = FId extends keyof FeatureMap ? keyof FeatureMap[FId]["events"] & string : never;

/** Distributive helper — maps a single dep ID to its qualified event keys. */
type _DepEventOf<D> = D extends keyof FeatureMap & string ? `${D}:${keyof FeatureMap[D]["events"] & string}` : never;

/** Qualified dependency event keys ("dep:event"), distributes over the deps union. */
type _DepEventKeys<FId> = _DepEventOf<_DepIds<FId>>;

/** Resolve own event payload. */
type _ResolveOwnEvent<FId, K extends string> = FId extends keyof FeatureMap
    ? K extends keyof FeatureMap[FId]["events"]
        ? FeatureMap[FId]["events"][K]
        : unknown
    : unknown;

/** Resolve any event payload (own or dep). */
type _ResolveEvent<FId, K extends string> = FId extends keyof FeatureMap
    ? K extends keyof FeatureMap[FId]["events"]
        ? FeatureMap[FId]["events"][K]
        : K extends `${infer D}:${infer E}`
          ? D extends _DepIds<FId> & keyof FeatureMap
              ? E extends keyof FeatureMap[D]["events"]
                  ? FeatureMap[D]["events"][E]
                  : unknown
              : unknown
          : unknown
    : unknown;

// ── Flat suggest helpers (unscoped BaseContext) ──────────────────────

/** All service keys across all features (mapped type distributes over each feature). */
type _AllSvcKeys = { [F in keyof FeatureMap]: keyof FeatureMap[F]["services"] & string }[keyof FeatureMap];

/** All task keys across all features (mapped type distributes over each feature). */
type _AllTaskKeys = { [F in keyof FeatureMap]: keyof FeatureMap[F]["tasks"] & string }[keyof FeatureMap];

/** All feature IDs. */
type _AllFeatureIds = keyof FeatureMap & string;

/** All event keys across all features. */
type _AllEventKeys = { [F in keyof FeatureMap]: keyof FeatureMap[F]["events"] & string }[keyof FeatureMap];

type _SuggestAllSvc = _AllSvcKeys | (string & {});
type _SuggestAllTask = _AllTaskKeys | (string & {});
type _SuggestAllFeature = _AllFeatureIds | (string & {});
type _SuggestAllEvent = _AllEventKeys | (string & {});

/** Flat resolve for unscoped service lookup. */
type _FlatResolveSvc<K extends string> = {
    [F in keyof FeatureMap]: K extends keyof FeatureMap[F]["services"] ? FeatureMap[F]["services"][K] : never;
}[keyof FeatureMap] extends infer U
    ? [U] extends [never]
        ? unknown
        : U
    : unknown;

/** Flat resolve for unscoped task lookup. FeatureMap stores payloads; wraps in TaskHandle. */
type _FlatResolveTask<K extends string> = {
    [F in keyof FeatureMap]: K extends keyof FeatureMap[F]["tasks"] ? TaskHandle<FeatureMap[F]["tasks"][K]> : never;
}[keyof FeatureMap] extends infer U
    ? [U] extends [never]
        ? unknown
        : U
    : unknown;

/** Flat resolve for unscoped feature lookup. */
type _FlatResolveFeature<K extends string> = K extends keyof FeatureMap
    ? import("./feature/handle").FeatureHandle
    : unknown;

/** Flat resolve for unscoped event lookup. */
type _FlatResolveEvent<K extends string> = {
    [F in keyof FeatureMap]: K extends keyof FeatureMap[F]["events"] ? FeatureMap[F]["events"][K] : never;
}[keyof FeatureMap] extends infer U
    ? [U] extends [never]
        ? unknown
        : U
    : unknown;

// ── Context types ────────────────────────────────────────────────────

/** Scoped context — used when `FId` is a concrete feature key. */
export type TypedContext<
    FId extends keyof FeatureMap,
    ExcludeSvc extends string = never,
    ExcludeTask extends string = never,
> = {
    signal: AbortSignal;
    logger: LoggerContext;
    getService: <K extends Exclude<_SuggestSvcKeys<FId>, ExcludeSvc>>(name: K) => _ResolveSvc<FId, K & string>;
    getTask: <K extends Exclude<_SuggestTaskKeys<FId>, ExcludeTask>>(name: K) => _ResolveTask<FId, K & string>;
    getFeature: <K extends _SuggestDepKeys<FId>>(name: K) => _ResolveFeature<FId, K & string>;
    events: {
        publish<K extends _OwnEventKeys<FId>>(
            event: K,
            ...args: undefined extends _ResolveOwnEvent<FId, K>
                ? [payload?: _ResolveOwnEvent<FId, K>]
                : [payload: _ResolveOwnEvent<FId, K>]
        ): void;
        on<K extends _OwnEventKeys<FId> | _DepEventKeys<FId>>(
            event: K,
            handler: (payload: _ResolveEvent<FId, K>) => void,
        ): () => void;
    };
    getWindow: <K extends _SuggestWindowKeys>(id: K) => CreatedWindow<_ResolveWindowApi<K & string>> | null;
    createView: <K extends _SuggestViewKeys>(id: K) => ElectroView;
    getView: <K extends _SuggestViewKeys>(id: K) => ElectroView | null;
};

/** Unscoped context — flat suggestions from all features. */
export type BaseContext = {
    signal: AbortSignal;
    logger: LoggerContext;
    getService: <K extends _SuggestAllSvc>(name: K) => _FlatResolveSvc<K & string>;
    getTask: <K extends _SuggestAllTask>(name: K) => _FlatResolveTask<K & string>;
    getFeature: <K extends _SuggestAllFeature>(name: K) => _FlatResolveFeature<K & string>;
    events: {
        publish(event: _SuggestAllEvent, payload?: unknown): void;
        on(event: string, handler: (payload: unknown) => void): () => void;
    };
    getWindow: <K extends _SuggestWindowKeys>(id: K) => CreatedWindow<_ResolveWindowApi<K & string>> | null;
    createView: <K extends _SuggestViewKeys>(id: K) => ElectroView;
    getView: <K extends _SuggestViewKeys>(id: K) => ElectroView | null;
};

// Logger contract
export interface LoggerContext {
    debug(code: string, message: string, details?: Record<string, unknown>): void;
    warn(code: string, message: string, details?: Record<string, unknown>): void;
    error(code: string, message: string, details?: Record<string, unknown>): void;
}
