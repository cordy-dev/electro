/**
 * Analytics feature — demonstrates non-critical feature + degraded mode.
 *
 * This feature throws on activation to show how the runtime handles
 * non-critical failures gracefully (continues in degraded mode).
 */
import { createFeature } from "@cordy/electro";

export const analyticsFeature = createFeature({
    id: "analytics",
    dependencies: ["app-core"],
    // critical: false (default) — failure won't crash the runtime
    critical: false,
    onActivate(ctx) {
        ctx.logger.warn("analytics", "Analytics provider unreachable", {});
        throw new Error("Analytics provider unavailable — running in degraded mode");
    },
})
