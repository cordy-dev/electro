import type { ViewManager } from "../view/manager";
import type { ViewRegistryEntry } from "../view/types";
import type { EventBus } from "./event-bus";

/**
 * Forwards EventBus publishes to renderer views via IPC.
 *
 * Respects deny-by-default policy: only views whose `features` array
 * includes the publishing feature's ID receive the event.
 *
 * IPC channel format: `electro:event:{featureId}:{eventName}`
 */
export class EventBridge {
    private readonly viewFeatures: Map<string, ReadonlySet<string>>;
    private removeInterceptor: (() => void) | null = null;

    constructor(
        private readonly eventBus: EventBus,
        private readonly viewManager: ViewManager,
        viewRegistry: readonly ViewRegistryEntry[],
    ) {
        this.viewFeatures = new Map();
        for (const entry of viewRegistry) {
            if (entry.features && entry.features.length > 0) {
                this.viewFeatures.set(entry.id, new Set(entry.features));
            }
        }
    }

    /** Start forwarding events to eligible views. */
    start(): void {
        if (this.removeInterceptor) return;
        this.removeInterceptor = this.eventBus.addInterceptor((channel, payload) => this.forward(channel, payload));
    }

    /** Stop forwarding and clean up. */
    stop(): void {
        this.removeInterceptor?.();
        this.removeInterceptor = null;
    }

    private forward(channel: string, payload: unknown): void {
        const colonIdx = channel.indexOf(":");
        if (colonIdx === -1) return;

        const featureId = channel.slice(0, colonIdx);
        const ipcChannel = `electro:event:${channel}`;

        for (const [viewId, allowed] of this.viewFeatures) {
            if (!allowed.has(featureId)) continue;

            const view = this.viewManager.get(viewId)?.view();
            if (!view || view.webContents.isDestroyed()) continue;

            try {
                view.webContents.send(ipcChannel, payload);
            } catch {
                // View may have been destroyed between check and send — skip gracefully.
            }
        }
    }
}
