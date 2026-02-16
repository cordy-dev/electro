import type { FeatureConfig, FeatureId } from "./types";

/**
 * Method for creating a feature
 * @param config - The configuration object for the feature
 * @returns The feature configuration object
 */
export function createFeature<FId extends FeatureId>(config: FeatureConfig<FId>): FeatureConfig<FId> {
    if (!config.id) throw new Error("Feature must have an id");
    return config;
}
