import type { WindowDefinition } from "../config/types";
import type { PolicyResult } from "./types";
import { PolicyDecision } from "./types";

/**
 * Deny-by-default policy engine for window–feature access control.
 *
 * A window's renderer can only access exposed services of features
 * listed in its `features: []` config. Everything else is denied.
 *
 * Used at:
 * - **Build time** (codegen): generate preload stubs only for allowed features
 * - **Runtime** (IPC routing): gate incoming calls from renderer
 */
export class PolicyEngine {
    private readonly policies = new Map<string, ReadonlySet<string>>();

    constructor(windows: readonly WindowDefinition[]) {
        for (const win of windows) {
            this.policies.set(win.name, new Set(win.features ?? []));
        }
    }

    /** Full policy check with decision code and context. */
    check(windowName: string, featureId: string): PolicyResult {
        const allowed = this.policies.get(windowName);

        if (!allowed) {
            return { decision: PolicyDecision.WINDOW_NOT_FOUND, windowName, featureId };
        }

        const decision = allowed.has(featureId) ? PolicyDecision.ALLOWED : PolicyDecision.ACCESS_DENIED;

        return { decision, windowName, featureId };
    }

    /** Convenience: returns true only when access is ALLOWED. */
    canAccess(windowName: string, featureId: string): boolean {
        return this.check(windowName, featureId).decision === PolicyDecision.ALLOWED;
    }

    /** Returns the allowed feature IDs for a window. Throws if window unknown. */
    getAllowedFeatures(windowName: string): readonly string[] {
        const allowed = this.policies.get(windowName);
        if (!allowed) {
            throw new Error(`Window "${windowName}" is not registered in the policy engine`);
        }
        return [...allowed];
    }

    /** Returns all registered window names. */
    getWindowNames(): string[] {
        return [...this.policies.keys()];
    }
}
