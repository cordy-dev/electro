import type { FeatureStatus } from "./enums";
import type { Feature } from "./feature";
import type { FeatureManager } from "./manager";
import type { FeatureId } from "./types";

/**
 * Ergonomic handle for a declared dependency Feature.
 *
 * Provides per-feature control: status, enable, disable.
 * Created by Feature and bound to `ctx.getFeature(name)`.
 */
export class FeatureHandle {
    constructor(
        private readonly feature: Feature<FeatureId>,
        private readonly manager: FeatureManager,
    ) {}

    /** Current lifecycle state. */
    status(): FeatureStatus {
        return this.feature.status;
    }

    /** Re-activate the feature (from DEACTIVATED or ERROR). */
    async enable(): Promise<void> {
        await this.manager.enable(this.feature.id);
    }

    /** Deactivate the feature. */
    async disable(): Promise<void> {
        await this.manager.disable(this.feature.id);
    }
}
