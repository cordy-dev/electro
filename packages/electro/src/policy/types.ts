/** Outcome of a policy check. */
export enum PolicyDecision {
    ALLOWED = "ALLOWED",
    ACCESS_DENIED = "ACCESS_DENIED",
    WINDOW_NOT_FOUND = "WINDOW_NOT_FOUND",
}

/** Result of a policy check with context. */
export interface PolicyResult {
    readonly decision: PolicyDecision;
    readonly windowName: string;
    readonly featureId: string;
}
