import type { EventInstance } from "../event-bus/types";
import type { ServiceInstance } from "../service/types";
import type { TaskInstance } from "../task/types";
import type { BaseContext, FeatureMap, TypedContext } from "../types";

export type FeatureId = string;
export type FeatureContext<
    FId extends FeatureId = string,
    ExcludeSvc extends string = never,
    ExcludeTask extends string = never,
> = FId extends keyof FeatureMap
    ? TypedContext<FId, ExcludeSvc, ExcludeTask>
    : BaseContext;

/** Suggest known feature IDs while accepting arbitrary strings. */
type SuggestFeatureIds = (keyof FeatureMap & string) | (string & {});

export type FeatureConfig<FId extends FeatureId> = {
    id: FId;
    critical?: boolean;
    dependencies?: SuggestFeatureIds[];
    services?: ServiceInstance[];
    tasks?: TaskInstance[];
    events?: EventInstance[];

    /**
     * OnInitialize
     * Lifecycle hook called when feature starts initializing
     * @param ctx Feature context
     */
    onInitialize?: (ctx: FeatureContext<FId>) => void | Promise<void>;

    /**
     * OnActivate
     * Lifecycle hook called when feature starts activating
     * @param ctx Feature context
     */
    onActivate?: (ctx: FeatureContext<FId>) => void | Promise<void>;

    /**
     * OnDeactivate
     * Lifecycle hook called when feature starts deactivating
     * @param ctx Feature context
     */
    onDeactivate?: (ctx: FeatureContext<FId>) => void | Promise<void>;

    /**
     * OnDestroy
     * Lifecycle hook called when feature starts destroying
     * @param ctx Feature context
     */
    onDestroy?: (ctx: FeatureContext<FId>) => void | Promise<void>;
};
