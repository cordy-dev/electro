import type { EventBus } from "./event-bus";
import type { EventHandler } from "./types";

/**
 * Scoped event access per feature.
 *
 * - `publish("name", payload)` -> publishes as `"ownerId:name"`
 * - `on("dep:name", handler)` -> validates `dep` is a declared dependency
 * - `on("name", handler)` -> subscribes to own `"ownerId:name"`
 */
export class EventAccessor {
    constructor(
        private readonly bus: EventBus,
        private readonly ownerId: string,
        private readonly declaredDeps: Set<string>,
    ) {}

    publish(event: string, payload?: unknown): void {
        this.bus.publish(`${this.ownerId}:${event}`, payload);
    }

    on(event: string, handler: EventHandler): () => void {
        const colonIdx = event.indexOf(":");
        if (colonIdx === -1) {
            // Own event: subscribe to "ownerId:event"
            return this.bus.subscribe(`${this.ownerId}:${event}`, handler, this.ownerId);
        }

        // Cross-feature event: "depId:eventName"
        const depId = event.slice(0, colonIdx);
        if (!this.declaredDeps.has(depId)) {
            throw new Error(
                `Feature "${this.ownerId}" cannot subscribe to "${event}": "${depId}" is not a declared dependency`,
            );
        }
        return this.bus.subscribe(event, handler, this.ownerId);
    }
}
