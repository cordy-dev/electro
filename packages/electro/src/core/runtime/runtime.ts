import type { WindowDefinition } from "../../config/types";
import { createDefaultWindowFactory } from "../../window/default-factory";
import { WindowManager } from "../../window/manager";
import { EventBus } from "../event-bus/event-bus";
import { FeatureStatus } from "../feature/enums";
import { FeatureManager } from "../feature/manager";
import type { FeatureConfig, FeatureId } from "../feature/types";
import { createConsoleHandler } from "../logger/console-handler";
import { Logger } from "../logger/logger";
import { StateMachine } from "../state-machine/state-machine";
import { RuntimeState } from "./enums";
import type { RuntimeConfig } from "./types";

declare const __ELECTRO_WINDOW_DEFINITIONS__: undefined | Array<Partial<WindowDefinition>>;

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
    private windowManager: WindowManager | null = null;

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

        // Register initial features
        if (config?.features) {
            this.featureManager.register(config.features);
        }
    }

    /** @internal Inject window manager (called by Electron layer before start). */
    _injectWindowManager(windowManager: WindowManager): void {
        this.state.assertState(RuntimeState.CREATED);
        this.windowManager = windowManager;
        this.featureManager.setWindowManager(windowManager);
    }

    // biome-ignore lint/suspicious/noExplicitAny: variance — typed FeatureConfig<"x"> must be assignable here
    register(features: FeatureConfig<any> | FeatureConfig<any>[]): void {
        this.state.assertState(RuntimeState.CREATED);
        this.featureManager.register(features);
    }

    async start(): Promise<void> {
        // Auto-setup window manager from build-injected definitions
        if (!this.windowManager && typeof __ELECTRO_WINDOW_DEFINITIONS__ !== "undefined") {
            const factory = createDefaultWindowFactory();
            const wm = new WindowManager(factory);
            for (const def of __ELECTRO_WINDOW_DEFINITIONS__) {
                wm.registerDefinition(def as WindowDefinition);
            }
            this._injectWindowManager(wm);
        }

        this.state.transition(RuntimeState.STARTING);
        try {
            await this.featureManager.bootstrap();
            this.state.transition(RuntimeState.RUNNING);
        } catch (err) {
            this.state.transition(RuntimeState.FAILED);
            throw err;
        }
    }

    async shutdown(): Promise<void> {
        this.state.assertState(RuntimeState.RUNNING);
        this.state.transition(RuntimeState.STOPPING);
        await this.featureManager.shutdown();
        this.windowManager?.destroyAll();
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
