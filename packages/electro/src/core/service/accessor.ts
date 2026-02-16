import { ServiceScope } from "./enums";
import type { ServiceManager } from "./manager";

/**
 * Implements `ctx.getService(name)` with scope-aware access control.
 *
 * - `"serviceId"` — own-feature lookup, all scopes visible, returns API directly.
 * - `"featureId:serviceId"` — cross-feature lookup, only INTERNAL + EXPOSED visible.
 */
export class ServiceAccessor {
    constructor(
        private readonly own: ServiceManager,
        private readonly deps: Map<string, ServiceManager>,
    ) {}

    /**
     * Resolve a service by name.
     *
     * @param name Either `"serviceId"` (own feature) or `"featureId:serviceId"` (cross-feature).
     * @returns The service API directly.
     * @throws If the service or feature is not found, or scope is not accessible.
     */
    get(name: string): unknown {
        const colonIdx = name.indexOf(":");
        if (colonIdx === -1) {
            return this.resolveOwn(name);
        }

        const featureId = name.slice(0, colonIdx);
        const serviceId = name.slice(colonIdx + 1);
        return this.resolveDep(featureId, serviceId);
    }

    private resolveOwn(serviceId: string): unknown {
        const result = this.own.get(serviceId);
        if (!result) {
            throw new Error(`Service "${serviceId}" not found in own feature`);
        }
        return result.api;
    }

    private resolveDep(featureId: string, serviceId: string): unknown {
        const manager = this.deps.get(featureId);
        if (!manager) {
            throw new Error(`Feature "${featureId}" is not a declared dependency`);
        }
        const result = manager.get(serviceId);
        if (!result) {
            throw new Error(`Service "${serviceId}" not found in feature "${featureId}"`);
        }
        if (result.scope === ServiceScope.PRIVATE) {
            throw new Error(
                `Service "${serviceId}" in feature "${featureId}" is private and not accessible cross-feature`,
            );
        }
        return result.api;
    }
}
