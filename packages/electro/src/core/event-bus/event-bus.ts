import type { EventHandler, EventInterceptor, EventSubscription } from "./types";

export class EventBus {
    private readonly subscriptions: Map<string, Set<EventSubscription>> = new Map();
    private readonly interceptors: Set<EventInterceptor> = new Set();

    publish(channel: string, payload?: unknown): void {
        const subs = this.subscriptions.get(channel);
        if (subs) {
            for (const sub of subs) {
                sub.handler(payload);
            }
        }
        for (const interceptor of this.interceptors) {
            interceptor(channel, payload);
        }
    }

    /** Register an interceptor that receives every published event. Returns an unsubscribe function. */
    addInterceptor(fn: EventInterceptor): () => void {
        this.interceptors.add(fn);
        return () => {
            this.interceptors.delete(fn);
        };
    }

    subscribe(channel: string, handler: EventHandler, ownerId: string): () => void {
        const sub: EventSubscription = { channel, handler, ownerId };
        let channelSubs = this.subscriptions.get(channel);
        if (!channelSubs) {
            channelSubs = new Set();
            this.subscriptions.set(channel, channelSubs);
        }
        channelSubs.add(sub);

        return () => {
            channelSubs.delete(sub);
            if (channelSubs.size === 0) {
                this.subscriptions.delete(channel);
            }
        };
    }

    removeByOwner(ownerId: string): void {
        for (const [channel, subs] of this.subscriptions) {
            for (const sub of subs) {
                if (sub.ownerId === ownerId) {
                    subs.delete(sub);
                }
            }
            if (subs.size === 0) {
                this.subscriptions.delete(channel);
            }
        }
    }
}
