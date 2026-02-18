import { WindowAccessor } from "../../window/accessor";
import type { WindowManager } from "../../window/manager";
import { EventAccessor } from "../event-bus/accessor";
import type { EventBus } from "../event-bus/event-bus";
import { ServiceAccessor } from "../service/accessor";
import { ServiceManager } from "../service/manager";
import { StateMachine } from "../state-machine/state-machine";
import { TaskHandle } from "../task/handle";
import { TaskManager } from "../task/manager";
import type { LoggerContext } from "../types";
import { FeatureStatus } from "./enums";
import { FeatureHandle } from "./handle";
import type { FeatureManager } from "./manager";
import type { FeatureConfig, FeatureContext, FeatureId } from "./types";

/** Allowed state transitions for the Feature FSM. */
const TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
    [FeatureStatus.NONE]: [FeatureStatus.REGISTERED],
    [FeatureStatus.REGISTERED]: [FeatureStatus.INITIALIZING],
    [FeatureStatus.INITIALIZING]: [FeatureStatus.READY, FeatureStatus.ERROR],
    [FeatureStatus.READY]: [FeatureStatus.ACTIVATING],
    [FeatureStatus.ACTIVATING]: [FeatureStatus.ACTIVATED, FeatureStatus.ERROR],
    [FeatureStatus.ACTIVATED]: [FeatureStatus.DEACTIVATING],
    [FeatureStatus.DEACTIVATING]: [FeatureStatus.DEACTIVATED, FeatureStatus.ERROR],
    [FeatureStatus.DEACTIVATED]: [FeatureStatus.ACTIVATING, FeatureStatus.DESTROYING],
    [FeatureStatus.DESTROYING]: [FeatureStatus.DESTROYED, FeatureStatus.ERROR],
    [FeatureStatus.DESTROYED]: [],
    [FeatureStatus.ERROR]: [FeatureStatus.ACTIVATING, FeatureStatus.DESTROYING],
};

export class Feature<FId extends FeatureId> {
    public readonly state: StateMachine<FeatureStatus>;
    public controller: AbortController = new AbortController();
    // biome-ignore lint/suspicious/noExplicitAny: runtime context is built dynamically in buildContext()
    public context: FeatureContext<any>;
    public serviceManager: ServiceManager | null = null;
    private taskManager: TaskManager | null = null;
    private eventBus: EventBus | null = null;

    constructor(
        public readonly config: FeatureConfig<FId>,
        public readonly logger: LoggerContext,
    ) {
        this.state = new StateMachine<FeatureStatus>({
            transitions: TRANSITIONS,
            initial: FeatureStatus.NONE,
            name: `feature "${config.id}"`,
        });
        this.context = {
            getService: () => {
                throw new Error("Services not yet initialized");
            },
            getTask: () => {
                throw new Error("Tasks not yet initialized");
            },
            getFeature: () => {
                throw new Error("Features not yet initialized");
            },
            events: {
                publish: () => {
                    throw new Error("Events not yet initialized");
                },
                on: () => {
                    throw new Error("Events not yet initialized");
                },
            },
            createWindow: () => {
                throw new Error("Window manager not available");
            },
            getWindow: () => {
                throw new Error("Window manager not available");
            },
            logger: this.logger,
            signal: this.controller.signal,
        };
    }

    get id(): FId {
        return this.config.id;
    }

    get status(): FeatureStatus {
        return this.state.current;
    }

    /**
     * Validate and apply an FSM transition.
     * @throws If the transition is not allowed from the current state.
     */
    public transition(target: FeatureStatus): void {
        this.state.transition(target);
    }

    public async initialize(
        features: Feature<FeatureId>[],
        manager: FeatureManager,
        eventBus?: EventBus,
        windowManager?: WindowManager,
    ): Promise<void> {
        this.buildContext(features, manager, eventBus, windowManager);
        await this.config.onInitialize?.(this.context);
    }

    public async activate(): Promise<void> {
        await this.config.onActivate?.(this.context);
        this.taskManager?.startup();
    }

    public async deactivate(): Promise<void> {
        if (this.eventBus) {
            this.eventBus.removeByOwner(this.id);
        }
        this.taskManager?.shutdown();
        if (this.serviceManager) {
            this.serviceManager.shutdown();
        }
        await this.config.onDeactivate?.(this.context);
    }

    public async destroy(): Promise<void> {
        await this.config.onDestroy?.(this.context);
    }

    private buildContext(
        features: Feature<FeatureId>[],
        manager: FeatureManager,
        eventBus?: EventBus,
        windowManager?: WindowManager,
    ): void {
        this.context.signal = this.controller.signal;
        this.context.logger = this.logger;

        // build services context
        this.serviceManager = new ServiceManager(this.context);
        for (const service of this.config.services ?? []) {
            this.serviceManager.register(service);
        }

        // build dependency map for cross-feature service access
        const deps = new Map<string, ServiceManager>();
        for (const dep of features) {
            if (dep.serviceManager) {
                deps.set(dep.id, dep.serviceManager);
            }
        }

        // wire getService before startup so service api() can resolve sibling services
        const accessor = new ServiceAccessor(this.serviceManager, deps);
        this.context.getService = ((name: string) => accessor.get(name)) as FeatureContext<any>["getService"];

        this.serviceManager.startup();

        // build tasks context
        this.taskManager = new TaskManager(this.context);
        for (const task of this.config.tasks ?? []) {
            this.taskManager.register(task);
        }

        this.context.getTask = ((name: string) => {
            const taskInstance = this.taskManager!.getTaskInstance(name);
            return new TaskHandle(taskInstance, this.context);
        }) as FeatureContext<any>["getTask"];

        // build getFeature — only declared dependencies are accessible
        const declaredDeps = new Set(this.config.dependencies ?? []);
        this.context.getFeature = ((name: string) => {
            if (!declaredDeps.has(name)) {
                throw new Error(`Feature "${name}" is not a declared dependency of "${this.id}"`);
            }
            const dep = features.find((f) => f.id === name);
            if (!dep) {
                throw new Error(`Feature "${name}" not found`);
            }
            return new FeatureHandle(dep, manager);
        }) as FeatureContext<any>["getFeature"];

        // build events context
        if (eventBus) {
            this.eventBus = eventBus;
            const eventAccessor = new EventAccessor(eventBus, this.id, declaredDeps);

            // Build defaults map from registered events
            const eventDefaults = new Map<string, unknown>();
            for (const evt of this.config.events ?? []) {
                if (evt.defaults !== undefined) {
                    eventDefaults.set(evt.id, evt.defaults);
                }
            }

            this.context.events = {
                publish: (event: string, payload?: unknown) => {
                    const resolved = payload ?? eventDefaults.get(event);
                    eventAccessor.publish(event, resolved);
                },
                on: (event: string, handler: (payload: unknown) => void) => {
                    return eventAccessor.on(event, handler);
                },
            };
        }

        // build window context (Electron layer only)
        if (windowManager) {
            const windowAccessor = new WindowAccessor(windowManager);
            this.context.createWindow = (name: string) => windowAccessor.createWindow(name);
            this.context.getWindow = (name: string) => windowAccessor.getWindow(name);
        }
    }
}
