/** Outcome of a policy check. */
export enum PolicyDecision {
    ALLOWED = "ALLOWED",
    ACCESS_DENIED = "ACCESS_DENIED",
    VIEW_NOT_FOUND = "VIEW_NOT_FOUND",
}

/** Result of a policy check with context. */
export interface PolicyResult {
    readonly decision: PolicyDecision;
    readonly viewName: string;
    readonly featureId: string;
}
