/**
 * Contract: Feature -- single feature unit with strict FSM lifecycle.
 *
 * State machine:
 *   NONE -> REGISTERED -> INITIALIZING -> READY -> ACTIVATING -> ACTIVATED
 *                                    \-> ERROR
 *                                                     \-> ERROR
 *   ACTIVATED -> DEACTIVATING -> DEACTIVATED -> ACTIVATING (re-enable)
 *                           \-> ERROR          \-> DESTROYING -> DESTROYED
 *   ERROR -> ACTIVATING (retry) | DESTROYING (cleanup)
 *   DESTROYED -> (terminal)
 *
 * Sections:
 *   1. Construction & identity
 *   2. Valid FSM transitions
 *   3. Illegal FSM transitions (must throw)
 *   4. Lifecycle hooks
 *   5. Context wiring
 */
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus/event-bus";
import { createEvent } from "../event-bus/helpers";
import { ServiceScope } from "../service/enums";
import { createService } from "../service/helpers";
import type { TaskHandle } from "../task/handle";
import { createTask } from "../task/helpers";
import type { LoggerContext } from "../types";
import { FeatureStatus } from "./enums";
import { Feature } from "./feature";
import type { FeatureHandle } from "./handle";
import { createFeature } from "./helpers";
import { FeatureManager } from "./manager";
import type { FeatureConfig } from "./types";

// -- Helpers ------------------------------------------------------------------

function mockLogger(): LoggerContext {
    return { debug() {}, warn() {}, error() {} };
}

function createFeatureInstance(overrides: Partial<FeatureConfig<string>> = {}): Feature<string> {
    return new Feature(createFeature({ id: "test-feature", ...overrides }), mockLogger());
}

const dummyMgr = new FeatureManager(mockLogger());

// -- Tests --------------------------------------------------------------------

describe("Feature", () => {
    // -- 0. createFeature validation -------------------------------------------

    describe("createFeature validation", () => {
        it("throws when id is empty string", () => {
            expect(() => createFeature({ id: "" })).toThrow("Feature must have an id");
        });
    });

    // -- 1. Construction & identity -------------------------------------------

    describe("Construction & identity", () => {
        it("exposes id from config", () => {
            const f = createFeatureInstance({ id: "my-feature" });
            expect(f.id).toBe("my-feature");
        });

        it("initial status is NONE", () => {
            const f = createFeatureInstance();
            expect(f.status).toBe(FeatureStatus.NONE);
        });

        it("context has stub getService/getTask/getFeature/events that throw", () => {
            const f = createFeatureInstance();
            expect(() => f.context.getService("x")).toThrow("Services not yet initialized");
            expect(() => f.context.getTask("x")).toThrow("Tasks not yet initialized");
            expect(() => f.context.getFeature("x")).toThrow("Features not yet initialized");
            expect(() => f.context.events.publish("x")).toThrow("Events not yet initialized");
            expect(() => f.context.events.on("x", () => {})).toThrow("Events not yet initialized");
        });
    });

    // -- 2. Valid FSM transitions ---------------------------------------------

    describe("Valid FSM transitions", () => {
        it("NONE -> REGISTERED", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            expect(f.status).toBe(FeatureStatus.REGISTERED);
        });

        it("REGISTERED -> INITIALIZING", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            expect(f.status).toBe(FeatureStatus.INITIALIZING);
        });

        it("INITIALIZING -> READY", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            expect(f.status).toBe(FeatureStatus.READY);
        });

        it("INITIALIZING -> ERROR", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.ERROR);
            expect(f.status).toBe(FeatureStatus.ERROR);
        });

        it("READY -> ACTIVATING", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            expect(f.status).toBe(FeatureStatus.ACTIVATING);
        });

        it("ACTIVATING -> ACTIVATED", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            expect(f.status).toBe(FeatureStatus.ACTIVATED);
        });

        it("ACTIVATING -> ERROR", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ERROR);
            expect(f.status).toBe(FeatureStatus.ERROR);
        });

        it("ACTIVATED -> DEACTIVATING", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            expect(f.status).toBe(FeatureStatus.DEACTIVATING);
        });

        it("DEACTIVATING -> DEACTIVATED", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            f.transition(FeatureStatus.DEACTIVATED);
            expect(f.status).toBe(FeatureStatus.DEACTIVATED);
        });

        it("DEACTIVATING -> ERROR", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            f.transition(FeatureStatus.ERROR);
            expect(f.status).toBe(FeatureStatus.ERROR);
        });

        it("DEACTIVATED -> ACTIVATING (re-enable cycle)", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            f.transition(FeatureStatus.DEACTIVATED);
            f.transition(FeatureStatus.ACTIVATING);
            expect(f.status).toBe(FeatureStatus.ACTIVATING);
        });

        it("ERROR -> ACTIVATING (retry)", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.ERROR);
            f.transition(FeatureStatus.ACTIVATING);
            expect(f.status).toBe(FeatureStatus.ACTIVATING);
        });

        it("ERROR -> DESTROYING (shutdown cleanup)", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.ERROR);
            f.transition(FeatureStatus.DESTROYING);
            expect(f.status).toBe(FeatureStatus.DESTROYING);
        });

        it("DEACTIVATED -> DESTROYING (shutdown)", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            f.transition(FeatureStatus.DEACTIVATED);
            f.transition(FeatureStatus.DESTROYING);
            expect(f.status).toBe(FeatureStatus.DESTROYING);
        });

        it("DESTROYING -> DESTROYED", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            f.transition(FeatureStatus.DEACTIVATED);
            f.transition(FeatureStatus.DESTROYING);
            f.transition(FeatureStatus.DESTROYED);
            expect(f.status).toBe(FeatureStatus.DESTROYED);
        });

        it("DESTROYING -> ERROR", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            f.transition(FeatureStatus.DEACTIVATED);
            f.transition(FeatureStatus.DESTROYING);
            f.transition(FeatureStatus.ERROR);
            expect(f.status).toBe(FeatureStatus.ERROR);
        });
    });

    // -- 3. Illegal FSM transitions -------------------------------------------

    describe("Illegal FSM transitions (must throw)", () => {
        it("NONE -> ACTIVATED throws", () => {
            const f = createFeatureInstance();
            expect(() => f.transition(FeatureStatus.ACTIVATED)).toThrow(
                'Illegal transition: "none" \u2192 "activated" for "feature "test-feature""',
            );
        });

        it("REGISTERED -> ACTIVATED throws", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            expect(() => f.transition(FeatureStatus.ACTIVATED)).toThrow(
                'Illegal transition: "registered" \u2192 "activated" for "feature "test-feature""',
            );
        });

        it("READY -> DEACTIVATING throws", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            expect(() => f.transition(FeatureStatus.DEACTIVATING)).toThrow(
                'Illegal transition: "ready" \u2192 "deactivating" for "feature "test-feature""',
            );
        });

        it("DESTROYED -> REGISTERED throws", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            f.transition(FeatureStatus.DEACTIVATING);
            f.transition(FeatureStatus.DEACTIVATED);
            f.transition(FeatureStatus.DESTROYING);
            f.transition(FeatureStatus.DESTROYED);
            expect(() => f.transition(FeatureStatus.REGISTERED)).toThrow(
                'Illegal transition: "destroyed" \u2192 "registered" for "feature "test-feature""',
            );
        });

        it("ACTIVATED -> ACTIVATING throws (must deactivate first)", () => {
            const f = createFeatureInstance();
            f.transition(FeatureStatus.REGISTERED);
            f.transition(FeatureStatus.INITIALIZING);
            f.transition(FeatureStatus.READY);
            f.transition(FeatureStatus.ACTIVATING);
            f.transition(FeatureStatus.ACTIVATED);
            expect(() => f.transition(FeatureStatus.ACTIVATING)).toThrow(
                'Illegal transition: "activated" \u2192 "activating" for "feature "test-feature""',
            );
        });

        it("does not mutate status on illegal transition", () => {
            const f = createFeatureInstance();
            try {
                f.transition(FeatureStatus.ACTIVATED);
            } catch {
                // expected
            }
            expect(f.status).toBe(FeatureStatus.NONE);
        });
    });

    // -- 4. Lifecycle hooks ---------------------------------------------------

    describe("Lifecycle hooks", () => {
        it("initialize() calls onInitialize hook", async () => {
            const onInitialize = vi.fn();
            const f = createFeatureInstance({ onInitialize });
            await f.initialize([], dummyMgr);
            expect(onInitialize).toHaveBeenCalledOnce();
            expect(onInitialize).toHaveBeenCalledWith(f.context);
        });

        it("activate() calls onActivate hook", async () => {
            const onActivate = vi.fn();
            const f = createFeatureInstance({ onActivate });
            await f.initialize([], dummyMgr);
            await f.activate();
            expect(onActivate).toHaveBeenCalledOnce();
            expect(onActivate).toHaveBeenCalledWith(f.context);
        });

        it("deactivate() calls onDeactivate hook", async () => {
            const onDeactivate = vi.fn();
            const f = createFeatureInstance({ onDeactivate });
            await f.initialize([], dummyMgr);
            await f.deactivate();
            expect(onDeactivate).toHaveBeenCalledOnce();
            expect(onDeactivate).toHaveBeenCalledWith(f.context);
        });

        it("destroy() calls onDestroy hook", async () => {
            const onDestroy = vi.fn();
            const f = createFeatureInstance({ onDestroy });
            await f.destroy();
            expect(onDestroy).toHaveBeenCalledOnce();
            expect(onDestroy).toHaveBeenCalledWith(f.context);
        });

        it("hooks are optional -- no error when omitted", async () => {
            const f = createFeatureInstance();
            await expect(f.initialize([], dummyMgr)).resolves.not.toThrow();
            await expect(f.activate()).resolves.not.toThrow();
            await expect(f.deactivate()).resolves.not.toThrow();
            await expect(f.destroy()).resolves.not.toThrow();
        });

        it("deactivate() is safe before initialize (no serviceManager/taskManager)", async () => {
            const f = createFeatureInstance();
            await expect(f.deactivate()).resolves.not.toThrow();
        });
    });

    // -- 5. Context wiring ----------------------------------------------------

    describe("Context wiring", () => {
        it("initialize() wires getService via ServiceAccessor", async () => {
            const service = createService({
                id: "my-svc",
                scope: ServiceScope.EXPOSED,
                api: () => ({ hello: () => "world" }),
            });
            const f = createFeatureInstance({ services: [service] });
            await f.initialize([], dummyMgr);

            const resolved = f.context.getService("my-svc") as { hello(): string };
            expect(resolved).toBeDefined();
            expect(resolved.hello()).toBe("world");
        });

        it("initialize() wires getTask via TaskHandle", async () => {
            const task = createTask({
                id: "my-task",
                execute: async () => {},
            });
            const f = createFeatureInstance({ tasks: [task] });
            await f.initialize([], dummyMgr);

            const handle = f.context.getTask("my-task") as TaskHandle;
            expect(handle).toBeDefined();
            expect(typeof handle.start).toBe("function");
            expect(typeof handle.stop).toBe("function");
            expect(typeof handle.queue).toBe("function");
        });

        it("activate() starts the task manager", async () => {
            let started = false;
            const task = createTask({
                id: "auto-task",
                autoStart: true,
                execute: async () => {
                    started = true;
                },
            });
            const f = createFeatureInstance({ tasks: [task] });
            await f.initialize([], dummyMgr);

            // Before activate, task should not have started
            expect(started).toBe(false);

            await f.activate();
            // Give async a tick to run
            await new Promise((r) => setTimeout(r, 20));
            expect(started).toBe(true);
        });
    });

    // -- 6. getFeature wiring -------------------------------------------------

    describe("getFeature wiring", () => {
        it("ctx.getFeature returns handle for declared dependency", async () => {
            const dep = new Feature({ id: "dep" }, mockLogger());
            dep.transition(FeatureStatus.REGISTERED);
            dep.transition(FeatureStatus.INITIALIZING);
            dep.transition(FeatureStatus.READY);
            dep.transition(FeatureStatus.ACTIVATING);
            dep.transition(FeatureStatus.ACTIVATED);

            const mgr = new FeatureManager(mockLogger());
            const f = createFeatureInstance({ dependencies: ["dep"] });
            await f.initialize([dep], mgr);
            const handle = f.context.getFeature("dep") as FeatureHandle;
            expect(handle.status()).toBe(FeatureStatus.ACTIVATED);
        });

        it("ctx.getFeature throws for undeclared dependency", async () => {
            const mgr = new FeatureManager(mockLogger());
            const f = createFeatureInstance({ dependencies: [] });
            await f.initialize([], mgr);
            expect(() => f.context.getFeature("unknown")).toThrow("not a declared dependency");
        });

        it("ctx.getFeature throws when declared dep is not in features list", async () => {
            const mgr = new FeatureManager(mockLogger());
            const f = createFeatureInstance({ dependencies: ["missing"] });
            await f.initialize([], mgr);
            expect(() => f.context.getFeature("missing")).toThrow('Feature "missing" not found');
        });
    });

    // -- 7. Events wiring -----------------------------------------------------

    describe("Events wiring", () => {
        it("ctx.events.publish namespaces with feature id", async () => {
            const bus = new EventBus();
            const handler = vi.fn();
            bus.subscribe("test-feature:hello", handler, "external");

            const mgr = new FeatureManager(mockLogger(), bus);
            const f = createFeatureInstance({
                onActivate: async (ctx) => {
                    ctx.events.publish("hello", { msg: "world" });
                },
            });
            await f.initialize([], mgr, bus);
            await f.activate();
            expect(handler).toHaveBeenCalledWith({ msg: "world" });
        });

        it("ctx.events.on subscribes to own events", async () => {
            const bus = new EventBus();
            const mgr = new FeatureManager(mockLogger(), bus);
            const received: unknown[] = [];
            const f = createFeatureInstance({
                onActivate: async (ctx) => {
                    ctx.events.on("myEvent", (payload) => received.push(payload));
                    ctx.events.publish("myEvent", "data");
                },
            });
            await f.initialize([], mgr, bus);
            await f.activate();
            expect(received).toEqual(["data"]);
        });

        it("deactivate cleans up event subscriptions", async () => {
            const bus = new EventBus();
            const mgr = new FeatureManager(mockLogger(), bus);
            const handler = vi.fn();
            const f = createFeatureInstance({
                onActivate: async (ctx) => {
                    ctx.events.on("myEvent", handler);
                },
            });
            await f.initialize([], mgr, bus);
            await f.activate();
            await f.deactivate();
            bus.publish("test-feature:myEvent", "after-deactivate");
            expect(handler).not.toHaveBeenCalled();
        });

        it("publish uses event defaults when no payload provided", async () => {
            const bus = new EventBus();
            const handler = vi.fn();
            bus.subscribe("test-feature:ready", handler, "external");

            const readyEvent = createEvent("ready", { version: "0.0.0" });
            const mgr = new FeatureManager(mockLogger(), bus);
            const f = createFeatureInstance({
                events: [readyEvent],
                onActivate: async (ctx) => {
                    ctx.events.publish("ready");
                },
            });
            await f.initialize([], mgr, bus);
            await f.activate();
            expect(handler).toHaveBeenCalledWith({ version: "0.0.0" });
        });

        it("publish uses explicit payload over defaults", async () => {
            const bus = new EventBus();
            const handler = vi.fn();
            bus.subscribe("test-feature:ready", handler, "external");

            const readyEvent = createEvent("ready", { version: "0.0.0" });
            const mgr = new FeatureManager(mockLogger(), bus);
            const f = createFeatureInstance({
                events: [readyEvent],
                onActivate: async (ctx) => {
                    ctx.events.publish("ready", { version: "1.0.0" });
                },
            });
            await f.initialize([], mgr, bus);
            await f.activate();
            expect(handler).toHaveBeenCalledWith({ version: "1.0.0" });
        });
    });
});
