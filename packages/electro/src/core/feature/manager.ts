import type { WindowManager } from "../../window/manager";
import type { EventBus } from "../event-bus/event-bus";
import type { LoggerContext } from "../types";
import { FeatureStatus } from "./enums";
import { Feature } from "./feature";
import type { FeatureConfig, FeatureId } from "./types";

export class FeatureManager {
    private readonly registry = new Map<FeatureId, Feature<FeatureId>>();
    /** Global service ownership: serviceId → featureId. */
    private readonly serviceOwners = new Map<string, string>();
    /** Global task ownership: taskId → featureId. */
    private readonly taskOwners = new Map<string, string>();
    private windowManager: WindowManager | null = null;

    constructor(
        private logger: LoggerContext,
        private eventBus: EventBus | undefined = undefined,
    ) {}

    /** @internal Set the window manager (called by Electron layer before bootstrap). */
    setWindowManager(windowManager: WindowManager): void {
        this.windowManager = windowManager;
    }

    /**
     * Register a feature or a list of features.
     * If a feature with the same ID is already registered, a warning is logged and the feature is skipped.
     * @throws If a service or task ID is already owned by another feature.
     */
    // biome-ignore lint/suspicious/noExplicitAny: variance — typed FeatureConfig<"x"> must be assignable here
    public register(features: FeatureConfig<any> | FeatureConfig<any>[]): void {
        const list = Array.isArray(features) ? features : [features];

        for (const item of list) {
            if (this.registry.has(item.id)) {
                this.logger.warn("FeatureManager", `Feature "${item.id}" is already registered. Skipping.`);
                continue;
            }

            // Enforce uniqueness of service IDs (both within-feature and cross-feature)
            const seenSvcIds = new Set<string>();
            for (const svc of item.services ?? []) {
                if (seenSvcIds.has(svc.id)) {
                    throw new Error(`Duplicate service "${svc.id}" within feature "${item.id}" — one service per ID.`);
                }
                seenSvcIds.add(svc.id);

                const owner = this.serviceOwners.get(svc.id);
                if (owner !== undefined) {
                    throw new Error(
                        `Service "${svc.id}" is already registered by feature "${owner}". ` +
                            `Feature "${item.id}" cannot claim it — service IDs must be globally unique.`,
                    );
                }
            }

            // Enforce global uniqueness of task IDs
            for (const task of item.tasks ?? []) {
                const owner = this.taskOwners.get(task.id);
                if (owner !== undefined) {
                    throw new Error(
                        `Task "${task.id}" is already registered by feature "${owner}". ` +
                            `Feature "${item.id}" cannot claim it — task IDs must be globally unique.`,
                    );
                }
            }

            // Commit ownership
            for (const svc of item.services ?? []) {
                this.serviceOwners.set(svc.id, item.id);
            }
            for (const task of item.tasks ?? []) {
                this.taskOwners.set(task.id, item.id);
            }

            const feature = new Feature(item, this.logger);
            this.registry.set(feature.id, feature);
            feature.transition(FeatureStatus.REGISTERED);
        }
    }

    get(id: FeatureId): Feature<FeatureId> | undefined {
        return this.registry.get(id);
    }

    /** Returns all registered features. */
    list(): Feature<FeatureId>[] {
        return [...this.registry.values()];
    }

    /**
     * Bootstrap all features in dependency order.
     * Calls initialize -> activate on each feature.
     * The feature receives a context built externally (by Runtime).
     */
    public async bootstrap(): Promise<void> {
        const order = this.reorder();

        // Phase 1: Initialize
        for (const id of order) {
            await this.initialize(id);
        }

        // Phase 2: Activate
        for (const id of order) {
            await this.activate(id);
        }
    }

    /**
     * Initialize a feature.
     * Initializes the feature and sets its state to "ready" or "error".
     */
    private async initialize(id: FeatureId): Promise<void> {
        const feature = this.registry.get(id);
        if (feature?.status !== FeatureStatus.REGISTERED) return;

        feature.transition(FeatureStatus.INITIALIZING);

        try {
            const features: Feature<FeatureId>[] = [];
            const deps = feature.config.dependencies ?? [];
            for (const dep of deps) {
                features.push(this.registry.get(dep)!);
            }

            await feature.initialize(features, this, this.eventBus, this.windowManager ?? undefined);
            feature.transition(FeatureStatus.READY);
        } catch (err) {
            feature.transition(FeatureStatus.ERROR);
            this.logger.error(id, `initialize failed`, {
                error: err instanceof Error ? err.message : String(err),
            });

            if (feature.config.critical) {
                throw new Error(`Critical feature "${id}" failed to initialize`);
            }
        }
    }

    /**
     * Activate a feature.
     * @param id The ID of the feature to activate.
     * @param allowRetry When true, ERROR state features can be retried (used by enable()).
     */
    private async activate(id: FeatureId, allowRetry = false): Promise<void> {
        const feature = this.registry.get(id)!;

        const allowed = allowRetry
            ? [FeatureStatus.READY, FeatureStatus.DEACTIVATED, FeatureStatus.ERROR]
            : [FeatureStatus.READY, FeatureStatus.DEACTIVATED];
        if (!allowed.includes(feature.status)) return;

        // Skip if any dependency is in ERROR.
        // Note: READY -> ERROR is not a valid FSM transition, so we log and skip
        // without changing state. The feature stays in its current state.
        for (const depId of feature.config.dependencies ?? []) {
            const dep = this.registry.get(depId);
            if (dep?.status === FeatureStatus.ERROR) {
                this.logger.error(id, `cannot activate — dependency "${depId}" is in error state`);
                return;
            }
        }

        feature.transition(FeatureStatus.ACTIVATING);
        try {
            await feature.activate();
            feature.transition(FeatureStatus.ACTIVATED);
        } catch (err) {
            feature.transition(FeatureStatus.ERROR);
            this.logger.error(id, `activate failed`, {
                error: err instanceof Error ? err.message : String(err),
            });

            if (feature.config.critical) {
                throw new Error(`Critical feature "${id}" failed to activate`);
            }
        }
    }

    /**
     * Deactivate a feature.
     * @param id The ID of the feature to deactivate.
     */
    private async deactivate(id: FeatureId): Promise<void> {
        const feature = this.registry.get(id)!;
        if (![FeatureStatus.ACTIVATED].includes(feature.status)) return;

        feature.transition(FeatureStatus.DEACTIVATING);
        try {
            await feature.deactivate();
            feature.transition(FeatureStatus.DEACTIVATED);
        } catch (err) {
            feature.transition(FeatureStatus.ERROR);
            this.logger.error(id, `deactivate failed`, {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async destroy(id: FeatureId): Promise<void> {
        const feature = this.registry.get(id)!;
        if (![FeatureStatus.DEACTIVATED, FeatureStatus.ERROR].includes(feature.status)) return;

        feature.transition(FeatureStatus.DESTROYING);
        try {
            await feature.destroy();
            feature.transition(FeatureStatus.DESTROYED);
        } catch (err) {
            feature.transition(FeatureStatus.ERROR);
            this.logger.error(id, `destroy failed`, {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /** Public: re-activate a DEACTIVATED or ERROR feature. */
    public async enable(id: FeatureId): Promise<void> {
        const feature = this.registry.get(id);
        if (!feature) throw new Error(`Feature "${id}" not found`);
        await this.activate(id, true);
    }

    /** Public: deactivate an ACTIVATED feature. */
    public async disable(id: FeatureId): Promise<void> {
        const feature = this.registry.get(id);
        if (!feature) throw new Error(`Feature "${id}" not found`);
        await this.deactivate(id);
    }

    async shutdown(): Promise<void> {
        const order = [...this.reorder()].reverse();

        for (const id of order) {
            await this.deactivate(id);
        }

        for (const id of order) {
            await this.destroy(id);
        }
    }

    private reorder(): FeatureId[] {
        const sorted: FeatureId[] = [];
        const visited = new Set<FeatureId>();
        const visiting = new Set<FeatureId>();

        const visit = (id: FeatureId) => {
            if (visiting.has(id)) {
                throw new Error(`Circular dependency detected: Feature "${id}" depends on itself!`);
            }
            if (visited.has(id)) return;

            visiting.add(id);
            const feature = this.registry.get(id);

            if (!feature) {
                throw new Error(`Missing dependency: Feature "${id}" is not registered.`);
            }

            for (const depId of feature.config.dependencies ?? []) {
                visit(depId);
            }

            visiting.delete(id);
            visited.add(id);
            sorted.push(id);
        };

        for (const id of this.registry.keys()) {
            visit(id);
        }

        return sorted;
    }
}
