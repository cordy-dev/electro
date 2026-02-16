import type { LogHandler } from "../logger/types";
import type { FeatureConfig } from "../feature/types";

export type RuntimeConfig = {
    // biome-ignore lint/suspicious/noExplicitAny: variance — typed FeatureConfig<"x"> must be assignable here
    features?: FeatureConfig<any>[];
    logger?: {
        handlers?: LogHandler[];
    };
};
