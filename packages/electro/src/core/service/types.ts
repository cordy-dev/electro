import type { FeatureContext } from "../feature/types";
import type { _ServiceOwner } from "../types";
import type { ServiceScope, ServiceStatus } from "./enums";

export type ServiceId = string;

export type ServiceConfig<
    Scope extends ServiceScope = ServiceScope,
    TApi = unknown,
    TId extends ServiceId = ServiceId,
> = {
    id: TId;
    scope?: Scope;
    api: (ctx: FeatureContext<_ServiceOwner<TId>, TId>) => TApi;
};

export interface ServiceInfo {
    serviceId: ServiceId;
    scope: ServiceScope;
    state: ServiceStatus;
}

/**
 * Type-erased service interface for heterogeneous collections.
 *
 * Mirrors the public API of {@link Service} without exposing private fields.
 * Used internally by {@link ServiceManager} and {@link FeatureConfig}.
 */
export interface ServiceInstance {
    readonly id: ServiceId;
    readonly scope: ServiceScope;
    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    build(ctx: FeatureContext<any>): void;
    destroy(): void;
    api(): unknown;
    status(): ServiceInfo;
}

/**
 * Public interface returned by {@link createService}.
 *
 * Hides class internals so consumers can safely
 * `export const myService = createService({...})` without TypeScript
 * "cannot be named" errors in declaration emit.
 *
 * Generic parameters preserve scope + API types for codegen inference
 * (`_SvcApi<T>` infers from `api()`).
 */
export interface CreatedService<Scope extends ServiceScope = ServiceScope, TApi = unknown> {
    readonly id: ServiceId;
    readonly scope: Scope;
    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    build(ctx: FeatureContext<any>): void;
    destroy(): void;
    api(): TApi | null;
    status(): ServiceInfo;
}
