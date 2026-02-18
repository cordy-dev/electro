import type { FeatureConfig } from "../feature/types";
import type { LogHandler } from "../logger/types";

export type RuntimeConfig = {
    // biome-ignore lint/suspicious/noExplicitAny: variance — typed FeatureConfig<"x"> must be assignable here
    features?: FeatureConfig<any>[];
    logger?: {
        handlers?: LogHandler[];
    };
};
