/**
 * Contract: EventBus -- shared pub/sub singleton.
 *
 * Sections:
 *   1. publish / subscribe
 *   2. Unsubscribe
 *   3. removeByOwner
 *   4. Interceptors
 */
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus";

describe("EventBus", () => {
    describe("publish / subscribe", () => {
        it("handler receives published payload", () => {
            const bus = new EventBus();
            const handler = vi.fn();
            bus.subscribe("auth:login", handler, "analytics");
            bus.publish("auth:login", { userId: "123" });
            expect(handler).toHaveBeenCalledWith({ userId: "123" });
        });

        it("multiple subscribers receive the same event", () => {
            const bus = new EventBus();
            const a = vi.fn();
            const b = vi.fn();
            bus.subscribe("auth:login", a, "analytics");
            bus.subscribe("auth:login", b, "logger");
            bus.publish("auth:login", "data");
            expect(a).toHaveBeenCalledWith("data");
            expect(b).toHaveBeenCalledWith("data");
        });

        it("publish with no subscribers is a no-op", () => {
            const bus = new EventBus();
            expect(() => bus.publish("unknown:event", {})).not.toThrow();
        });

        it("publish without payload passes undefined", () => {
            const bus = new EventBus();
            const handler = vi.fn();
            bus.subscribe("test:ping", handler, "owner");
            bus.publish("test:ping");
            expect(handler).toHaveBeenCalledWith(undefined);
        });
    });

    describe("Unsubscribe", () => {
        it("unsubscribe stops handler from receiving events", () => {
            const bus = new EventBus();
            const handler = vi.fn();
            const unsub = bus.subscribe("test:event", handler, "owner");
            unsub();
            bus.publish("test:event", "data");
            expect(handler).not.toHaveBeenCalled();
        });

        it("unsubscribe does not affect other subscribers on same channel", () => {
            const bus = new EventBus();
            const a = vi.fn();
            const b = vi.fn();
            const unsubA = bus.subscribe("ch", a, "ownerA");
            bus.subscribe("ch", b, "ownerB");
            unsubA();
            bus.publish("ch", "data");
            expect(a).not.toHaveBeenCalled();
            expect(b).toHaveBeenCalledWith("data");
        });
    });

    describe("removeByOwner", () => {
        it("removes all subscriptions for a given owner", () => {
            const bus = new EventBus();
            const handler = vi.fn();
            bus.subscribe("ch1", handler, "analytics");
            bus.subscribe("ch2", handler, "analytics");
            bus.removeByOwner("analytics");
            bus.publish("ch1", "data");
            bus.publish("ch2", "data");
            expect(handler).not.toHaveBeenCalled();
        });

        it("does not affect subscriptions from other owners", () => {
            const bus = new EventBus();
            const a = vi.fn();
            const b = vi.fn();
            bus.subscribe("ch", a, "analytics");
            bus.subscribe("ch", b, "logger");
            bus.removeByOwner("analytics");
            bus.publish("ch", "data");
            expect(a).not.toHaveBeenCalled();
            expect(b).toHaveBeenCalledWith("data");
        });

        it("no-op when owner has no subscriptions", () => {
            const bus = new EventBus();
            expect(() => bus.removeByOwner("nonexistent")).not.toThrow();
        });
    });

    describe("Interceptors", () => {
        it("interceptor receives every published event", () => {
            const bus = new EventBus();
            const interceptor = vi.fn();
            bus.addInterceptor(interceptor);
            bus.publish("feat:event", { value: 1 });
            bus.publish("other:ping");
            expect(interceptor).toHaveBeenCalledTimes(2);
            expect(interceptor).toHaveBeenCalledWith("feat:event", { value: 1 });
            expect(interceptor).toHaveBeenCalledWith("other:ping", undefined);
        });

        it("interceptor fires even when no subscribers exist", () => {
            const bus = new EventBus();
            const interceptor = vi.fn();
            bus.addInterceptor(interceptor);
            bus.publish("no:subscribers", "data");
            expect(interceptor).toHaveBeenCalledWith("no:subscribers", "data");
        });

        it("removing interceptor stops it from receiving events", () => {
            const bus = new EventBus();
            const interceptor = vi.fn();
            const remove = bus.addInterceptor(interceptor);
            remove();
            bus.publish("feat:event", "data");
            expect(interceptor).not.toHaveBeenCalled();
        });

        it("multiple interceptors all receive events", () => {
            const bus = new EventBus();
            const a = vi.fn();
            const b = vi.fn();
            bus.addInterceptor(a);
            bus.addInterceptor(b);
            bus.publish("ch", "data");
            expect(a).toHaveBeenCalledWith("ch", "data");
            expect(b).toHaveBeenCalledWith("ch", "data");
        });

        it("interceptors fire after subscribers", () => {
            const bus = new EventBus();
            const order: string[] = [];
            bus.subscribe("ch", () => order.push("subscriber"), "owner");
            bus.addInterceptor(() => order.push("interceptor"));
            bus.publish("ch", "data");
            expect(order).toEqual(["subscriber", "interceptor"]);
        });
    });
});
