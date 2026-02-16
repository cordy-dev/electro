import type { FeatureContext } from "../feature/types";
import type { ServiceId, ServiceInfo, ServiceInstance } from "./types";

/**
 * Per-feature registry and lifecycle coordinator for {@link Service} instances.
 *
 * One service per id — `get()` returns `{ api, scope }` directly.
 */
export class ServiceManager {
    /** Primary storage: `id` → Service */
    private services = new Map<ServiceId, ServiceInstance>();
    private _isShutdown = false;

    // biome-ignore lint/suspicious/noExplicitAny: type-erased — accepts any FeatureContext variant
    constructor(private readonly ctx: FeatureContext<any>) {}

    // ── Registration ─────────────────────────────────────────────────────

    /** Add a service to the registry. Throws on duplicate id. */
    register(service: ServiceInstance): void {
        if (this.services.has(service.id)) {
            throw new Error(`Duplicate service: "${service.id}"`);
        }
        this.services.set(service.id, service);
    }

    /** Remove a service by id. Destroys it before removing. */
    unregister(serviceId: ServiceId): void {
        const service = this.services.get(serviceId);
        if (!service) return;
        service.destroy();
        this.services.delete(serviceId);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    /** Build all registered services. No-op after shutdown. */
    startup(): void {
        if (this._isShutdown) return;
        for (const service of this.services.values()) {
            service.build(this.ctx);
        }
    }

    /** Destroy all registered services. Marks manager as shut down. */
    shutdown(): void {
        this._isShutdown = true;
        for (const service of this.services.values()) {
            service.destroy();
        }
    }

    // ── Resolution ───────────────────────────────────────────────────────

    /**
     * Get a service by id, returning its API and scope.
     *
     * @returns `{ api, scope }` or `null` if service id is unknown or not yet built
     */
    get(serviceId: ServiceId): { api: unknown; scope: string } | null {
        const service = this.services.get(serviceId);
        if (!service) return null;
        const api = service.api();
        if (api == null) return null;
        return { api, scope: service.scope };
    }

    // ── Status / Listing ─────────────────────────────────────────────────

    /** Return status for a given service id. Throws if unknown. */
    status(serviceId: ServiceId): ServiceInfo {
        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service "${serviceId}" not found`);
        }
        return service.status();
    }

    /** Return status for all registered services. */
    list(): ServiceInfo[] {
        return Array.from(this.services.values()).map((s) => s.status());
    }
}
