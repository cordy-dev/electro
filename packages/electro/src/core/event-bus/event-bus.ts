import type { EventHandler, EventSubscription } from "./types";

export class EventBus {
    private readonly subscriptions: Map<string, Set<EventSubscription>> = new Map();

    publish(channel: string, payload?: unknown): void {
        const subs = this.subscriptions.get(channel);
        if (!subs) return;
        for (const sub of subs) {
            sub.handler(payload);
        }
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
