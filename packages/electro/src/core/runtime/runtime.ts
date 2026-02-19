import { EventBridge } from "../event-bus/bridge";
import { EventBus } from "../event-bus/event-bus";
import { FeatureStatus } from "../feature/enums";
import { FeatureManager } from "../feature/manager";
import type { FeatureConfig, FeatureId } from "../feature/types";
import { createConsoleHandler } from "../logger/console-handler";
import { Logger } from "../logger/logger";
import { StateMachine } from "../state-machine/state-machine";
import { ViewManager } from "../view/manager";
import type { ViewRegistryEntry } from "../view/types";
import { View } from "../view/view";
import { WindowManager } from "../window/manager";
import { RuntimeState } from "./enums";
import type { RuntimeConfig } from "./types";

declare const __ELECTRO_VIEW_REGISTRY__: ViewRegistryEntry[] | undefined;

const RUNTIME_TRANSITIONS: Record<RuntimeState, RuntimeState[]> = {
    [RuntimeState.CREATED]: [RuntimeState.STARTING],
    [RuntimeState.STARTING]: [RuntimeState.RUNNING, RuntimeState.FAILED],
    [RuntimeState.RUNNING]: [RuntimeState.STOPPING],
    [RuntimeState.STOPPING]: [RuntimeState.STOPPED],
    [RuntimeState.STOPPED]: [],
    [RuntimeState.FAILED]: [],
};

export class Runtime {
    readonly state: StateMachine<RuntimeState>;
    readonly logger: Logger;
    private readonly featureManager: FeatureManager;
    private readonly eventBus: EventBus;
    private readonly windowManager: WindowManager;
    private readonly viewManager: ViewManager;
    private readonly eventBridge: EventBridge | null = null;

    constructor(config?: RuntimeConfig) {
        this.state = new StateMachine<RuntimeState>({
            transitions: RUNTIME_TRANSITIONS,
            initial: RuntimeState.CREATED,
            name: "Runtime",
        });

        this.logger = new Logger();
        this.eventBus = new EventBus();
        this.featureManager = new FeatureManager(this.logger, this.eventBus);

        // Add default console handler
        this.logger.addHandler(createConsoleHandler());

        // Add custom handlers from config
        if (config?.logger?.handlers) {
            for (const handler of config.logger.handlers) {
                this.logger.addHandler(handler);
            }
        }

        // Register windows
        this.windowManager = new WindowManager();
        for (const win of config?.windows ?? []) {
            this.windowManager.register(win);
        }

        // Register views from CLI-injected registry
        this.viewManager = new ViewManager();
        const viewRegistry: ViewRegistryEntry[] =
            typeof __ELECTRO_VIEW_REGISTRY__ !== "undefined" ? __ELECTRO_VIEW_REGISTRY__ : [];
        for (const entry of viewRegistry) {
            this.viewManager.register(new View(entry));
        }

        // Wire event bridge for forwarding events to renderer views
        if (viewRegistry.some((v) => v.features && v.features.length > 0)) {
            this.eventBridge = new EventBridge(this.eventBus, this.viewManager, viewRegistry);
        }

        // Pass managers to feature manager
        this.featureManager.setWindowManager(this.windowManager);
        this.featureManager.setViewManager(this.viewManager);

        // Register initial features
        if (config?.features) {
            this.featureManager.register(config.features);
        }
    }

    // biome-ignore lint/suspicious/noExplicitAny: variance — typed FeatureConfig<"x"> must be assignable here
    register(features: FeatureConfig<any> | FeatureConfig<any>[]): void {
        this.state.assertState(RuntimeState.CREATED);
        this.featureManager.register(features);
    }

    async start(): Promise<void> {
        this.state.transition(RuntimeState.STARTING);
        try {
            this.eventBridge?.start();
            await this.featureManager.bootstrap();
            this.state.transition(RuntimeState.RUNNING);
        } catch (err) {
            this.eventBridge?.stop();
            this.state.transition(RuntimeState.FAILED);
            throw err;
        }
    }

    async shutdown(): Promise<void> {
        this.state.assertState(RuntimeState.RUNNING);
        this.state.transition(RuntimeState.STOPPING);
        this.eventBridge?.stop();
        await this.featureManager.shutdown();
        this.viewManager.destroyAll();
        this.windowManager.destroyAll();
        this.state.transition(RuntimeState.STOPPED);
    }

    async enable(id: FeatureId): Promise<void> {
        this.state.assertState(RuntimeState.RUNNING);
        await this.featureManager.enable(id);
    }

    async disable(id: FeatureId): Promise<void> {
        this.state.assertState(RuntimeState.RUNNING);
        await this.featureManager.disable(id);
    }

    isDegraded(): boolean {
        this.state.assertState(RuntimeState.RUNNING);
        const features = this.featureManager.list();
        return features.some((f) => f.status === FeatureStatus.ERROR);
    }
}
