/**
 * Contract: EventAccessor -- scoped event access per feature.
 *
 * Sections:
 *   1. publish (auto-namespaces)
 *   2. on (own events)
 *   3. on (cross-feature events with dependency validation)
 *   4. Cleanup via EventBus.removeByOwner
 */
import { describe, expect, it, vi } from "vitest";
import { EventAccessor } from "./accessor";
import { EventBus } from "./event-bus";

function createAccessor(bus: EventBus, ownerId: string, deps: string[] = []): EventAccessor {
    return new EventAccessor(bus, ownerId, new Set(deps));
}

describe("EventAccessor", () => {
    describe("publish (auto-namespaces)", () => {
        it("publish('pageView', data) emits as 'analytics:pageView'", () => {
            const bus = new EventBus();
            const handler = vi.fn();
            bus.subscribe("analytics:pageView", handler, "test");
            const accessor = createAccessor(bus, "analytics");
            accessor.publish("pageView", { url: "/home" });
            expect(handler).toHaveBeenCalledWith({ url: "/home" });
        });
    });

    describe("on (own events)", () => {
        it("on('pageView', handler) subscribes to 'analytics:pageView'", () => {
            const bus = new EventBus();
            const accessor = createAccessor(bus, "analytics");
            const handler = vi.fn();
            accessor.on("pageView", handler);
            bus.publish("analytics:pageView", "data");
            expect(handler).toHaveBeenCalledWith("data");
        });
    });

    describe("on (cross-feature events)", () => {
        it("on('auth:userLoggedIn', handler) works when auth is a declared dep", () => {
            const bus = new EventBus();
            const accessor = createAccessor(bus, "analytics", ["auth"]);
            const handler = vi.fn();
            accessor.on("auth:userLoggedIn", handler);
            bus.publish("auth:userLoggedIn", { userId: "123" });
            expect(handler).toHaveBeenCalledWith({ userId: "123" });
        });

        it("on('payments:charged', handler) throws when payments is not a declared dep", () => {
            const bus = new EventBus();
            const accessor = createAccessor(bus, "analytics", ["auth"]);
            expect(() => accessor.on("payments:charged", vi.fn())).toThrow(
                '"analytics" cannot subscribe to "payments:charged": "payments" is not a declared dependency',
            );
        });
    });

    describe("Cleanup", () => {
        it("bus.removeByOwner cleans up all accessor subscriptions", () => {
            const bus = new EventBus();
            const accessor = createAccessor(bus, "analytics", ["auth"]);
            const handler = vi.fn();
            accessor.on("pageView", handler);
            accessor.on("auth:login", handler);
            bus.removeByOwner("analytics");
            bus.publish("analytics:pageView", "data");
            bus.publish("auth:login", "data");
            expect(handler).not.toHaveBeenCalled();
        });

        it("individual unsubscribe works", () => {
            const bus = new EventBus();
            const accessor = createAccessor(bus, "analytics");
            const handler = vi.fn();
            const unsub = accessor.on("click", handler);
            unsub();
            bus.publish("analytics:click", "data");
            expect(handler).not.toHaveBeenCalled();
        });
    });
});
