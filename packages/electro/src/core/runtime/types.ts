import type { FeatureConfig } from "../feature/types";
import type { LogHandler } from "../logger/types";
import type { ViewInstance } from "../view/types";
import type { WindowInstance } from "../window/types";

export type RuntimeConfig = {
    // biome-ignore lint/suspicious/noExplicitAny: variance — typed FeatureConfig<"x"> must be assignable here
    features?: FeatureConfig<any>[];
    windows?: WindowInstance[];
    views?: ViewInstance[];
    logger?: {
        handlers?: LogHandler[];
    };
};
