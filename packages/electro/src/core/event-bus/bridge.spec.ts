/**
 * Contract: EventBridge -- forwards EventBus events to renderer views via IPC.
 *
 * Sections:
 *   1. Forwarding to eligible views
 *   2. Policy enforcement (deny-by-default)
 *   3. Lifecycle (start / stop)
 *   4. Graceful degradation (destroyed views, missing views)
 */
import { describe, expect, it, vi } from "vitest";
import type { ViewManager } from "../view/manager";
import type { ViewInstance } from "../view/types";
import { EventBridge } from "./bridge";
import { EventBus } from "./event-bus";

/** Create a mock ViewInstance with controllable webContents.send. */
function mockView(id: string, alive = true) {
    const send = vi.fn();
    return {
        id,
        send,
        instance: {
            id,
            create: vi.fn(),
            destroy: vi.fn(),
            view: () => (alive ? { webContents: { isDestroyed: () => false, send } } : null),
        } as unknown as ViewInstance,
    };
}

/** Create a mock ViewManager from a set of ViewInstances. */
function mockViewManager(views: ViewInstance[]): ViewManager {
    const map = new Map(views.map((v) => [v.id, v]));
    return { get: (id: string) => map.get(id) ?? null } as unknown as ViewManager;
}

describe("EventBridge", () => {
    describe("Forwarding to eligible views", () => {
        it("forwards events from allowed features to the view", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const vm = mockViewManager([splash.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["updater"] }]);
            bridge.start();

            bus.publish("updater:progress", { percent: 50 });

            expect(splash.send).toHaveBeenCalledWith("electro:event:updater:progress", { percent: 50 });
        });

        it("forwards to multiple views that allow the feature", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const main = mockView("main");
            const vm = mockViewManager([splash.instance, main.instance]);
            const bridge = new EventBridge(bus, vm, [
                { id: "splash", hasRenderer: true, features: ["core"] },
                { id: "main", hasRenderer: true, features: ["core"] },
            ]);
            bridge.start();

            bus.publish("core:ready", { version: "1.0" });

            expect(splash.send).toHaveBeenCalledWith("electro:event:core:ready", { version: "1.0" });
            expect(main.send).toHaveBeenCalledWith("electro:event:core:ready", { version: "1.0" });
        });

        it("forwards events without payload", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const vm = mockViewManager([splash.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();

            bus.publish("core:ping");

            expect(splash.send).toHaveBeenCalledWith("electro:event:core:ping", undefined);
        });
    });

    describe("Policy enforcement", () => {
        it("does NOT forward events from features the view is not subscribed to", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const vm = mockViewManager([splash.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();

            bus.publish("updater:progress", { percent: 50 });

            expect(splash.send).not.toHaveBeenCalled();
        });

        it("does NOT forward to views with empty features", () => {
            const bus = new EventBus();
            const main = mockView("main");
            const vm = mockViewManager([main.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "main", hasRenderer: true, features: [] }]);
            bridge.start();

            bus.publish("core:ready", {});

            expect(main.send).not.toHaveBeenCalled();
        });

        it("does NOT forward to views with no features field", () => {
            const bus = new EventBus();
            const main = mockView("main");
            const vm = mockViewManager([main.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "main", hasRenderer: true }]);
            bridge.start();

            bus.publish("core:ready", {});

            expect(main.send).not.toHaveBeenCalled();
        });

        it("ignores channels without a colon (malformed)", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const vm = mockViewManager([splash.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();

            bus.publish("nocolon", "data");

            expect(splash.send).not.toHaveBeenCalled();
        });
    });

    describe("Lifecycle", () => {
        it("does NOT forward before start()", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const vm = mockViewManager([splash.instance]);
            new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);

            bus.publish("core:ready", {});

            expect(splash.send).not.toHaveBeenCalled();
        });

        it("stops forwarding after stop()", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const vm = mockViewManager([splash.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();
            bridge.stop();

            bus.publish("core:ready", {});

            expect(splash.send).not.toHaveBeenCalled();
        });

        it("start() is idempotent", () => {
            const bus = new EventBus();
            const splash = mockView("splash");
            const vm = mockViewManager([splash.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();
            bridge.start(); // no-op

            bus.publish("core:ready", {});

            // Should receive exactly one call, not two
            expect(splash.send).toHaveBeenCalledTimes(1);
        });
    });

    describe("Graceful degradation", () => {
        it("skips views where view() returns null", () => {
            const bus = new EventBus();
            const splash = mockView("splash", false); // not alive
            const vm = mockViewManager([splash.instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();

            bus.publish("core:ready", {});

            expect(splash.send).not.toHaveBeenCalled();
        });

        it("skips views not registered in ViewManager", () => {
            const bus = new EventBus();
            const vm = mockViewManager([]); // empty
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();

            expect(() => bus.publish("core:ready", {})).not.toThrow();
        });

        it("skips views where webContents is destroyed", () => {
            const bus = new EventBus();
            const send = vi.fn();
            const instance = {
                id: "splash",
                create: vi.fn(),
                destroy: vi.fn(),
                view: () => ({
                    webContents: { isDestroyed: () => true, send },
                }),
            } as unknown as ViewInstance;
            const vm = mockViewManager([instance]);
            const bridge = new EventBridge(bus, vm, [{ id: "splash", hasRenderer: true, features: ["core"] }]);
            bridge.start();

            bus.publish("core:ready", {});

            expect(send).not.toHaveBeenCalled();
        });
    });
});
