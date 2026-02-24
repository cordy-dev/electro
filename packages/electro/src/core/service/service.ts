import type { FeatureContext } from "../feature/types";
import { ServiceScope, ServiceStatus } from "./enums";
import type { ServiceConfig, ServiceId, ServiceInfo } from "./types";

/**
 * Single service unit: one id, one scope, one factory.
 *
 * Lifecycle: Registered → Active (after build) → Destroyed (after destroy).
 * `build()` is idempotent — calling it when already Active is a no-op.
 */
export class Service<Scope extends ServiceScope, TApi, TId extends ServiceId = ServiceId> {
    private _status: ServiceStatus = ServiceStatus.REGISTERED;
    private _api: TApi | null = null;

    constructor(private readonly config: ServiceConfig<Scope, TApi, TId>) {}

    get id(): ServiceId {
        return this.config.id;
    }

    get scope(): Scope {
        return this.config.scope ?? (ServiceScope.PRIVATE as Scope);
    }

    /** Invoke the factory and store the result. Idempotent — no-op if already Active. */

    build(ctx: FeatureContext<any>): void {
        if (this._status === ServiceStatus.ACTIVE) return;
        if (this._status === ServiceStatus.DESTROYED) {
            throw new Error(`Service "${this.id}" (${this.scope}) is destroyed and cannot be rebuilt`);
        }
        this._api = this.config.api(ctx);
        this._status = ServiceStatus.ACTIVE;
    }

    /** Clear the factory result and mark as Destroyed. Idempotent. */
    destroy(): void {
        this._api = null;
        this._status = ServiceStatus.DESTROYED;
    }

    /** Return the factory result, or null if not yet built / destroyed. */
    api(): TApi | null {
        return this._api;
    }

    /** Snapshot of the service's current state. */
    status(): ServiceInfo {
        return {
            serviceId: this.id,
            scope: this.scope,
            state: this._status,
        };
    }
}
