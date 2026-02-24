import type { FeatureConfig } from "../feature/types";
import type { LogHandler } from "../logger/types";
import type { WindowInstance } from "../window/types";

export type RuntimeConfig = {
    features?: FeatureConfig<any>[];
    windows?: WindowInstance[];
    logger?: {
        handlers?: LogHandler[];
    };
};
