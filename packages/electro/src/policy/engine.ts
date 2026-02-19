import type { ViewDefinition } from "../config/types";
import type { PolicyResult } from "./types";
import { PolicyDecision } from "./types";

/**
 * Deny-by-default policy engine for view–feature access control.
 *
 * A view's renderer can only access exposed services of features
 * listed in its `features: []` config. Everything else is denied.
 *
 * Used at:
 * - **Build time** (codegen): generate preload stubs only for allowed features
 * - **Runtime** (IPC routing): gate incoming calls from renderer
 */
export class PolicyEngine {
    private readonly policies = new Map<string, ReadonlySet<string>>();

    constructor(views: readonly ViewDefinition[]) {
        for (const view of views) {
            this.policies.set(view.name, new Set(view.features ?? []));
        }
    }

    /** Full policy check with decision code and context. */
    check(viewName: string, featureId: string): PolicyResult {
        const allowed = this.policies.get(viewName);

        if (!allowed) {
            return { decision: PolicyDecision.VIEW_NOT_FOUND, viewName, featureId };
        }

        const decision = allowed.has(featureId) ? PolicyDecision.ALLOWED : PolicyDecision.ACCESS_DENIED;

        return { decision, viewName, featureId };
    }

    /** Convenience: returns true only when access is ALLOWED. */
    canAccess(viewName: string, featureId: string): boolean {
        return this.check(viewName, featureId).decision === PolicyDecision.ALLOWED;
    }

    /** Returns the allowed feature IDs for a view. Throws if view unknown. */
    getAllowedFeatures(viewName: string): readonly string[] {
        const allowed = this.policies.get(viewName);
        if (!allowed) {
            throw new Error(`View "${viewName}" is not registered in the policy engine`);
        }
        return [...allowed];
    }

    /** Returns all registered view names. */
    getViewNames(): string[] {
        return [...this.policies.keys()];
    }
}
