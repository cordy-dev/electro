import type { BaseWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowDefinition } from "../config/types";
import { createFeature } from "../core/feature/helpers";
import { createRuntime } from "../core/runtime/helpers";
import { WindowManager } from "./manager";
import type { ElectroWindow, WindowFactory } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────

let nextId = 1;

function stubFactory(): WindowFactory {
    return {
        create: vi.fn((): BaseWindow => {
            const id = nextId++;
            let destroyed = false;
            return {
                id,
                isDestroyed: () => destroyed,
                close: vi.fn(),
                show: vi.fn(),
                destroy: vi.fn(() => {
                    destroyed = true;
                }),
            } as unknown as BaseWindow;
        }),
    };
}

function stubDefinition(name: string): WindowDefinition {
    return { name, entry: "./index.html", __source: "/fake" } as WindowDefinition;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Window management integration", () => {
    beforeEach(() => {
        nextId = 1;
    });

    it("features can create and get windows via ctx", async () => {
        const factory = stubFactory();
        const windowManager = new WindowManager(factory);
        windowManager.registerDefinition(stubDefinition("main"));

        let createdWindow: BaseWindow | undefined;
        let gotWindow: BaseWindow | null | undefined;

        const appFeature = createFeature({
            id: "app",
            onActivate(ctx) {
                createdWindow = ctx.createWindow("main");
                gotWindow = ctx.getWindow("main");
            },
        });

        const runtime = createRuntime({
            features: [appFeature],
            logger: { handlers: [] },
        });

        runtime._injectWindowManager(windowManager);
        await runtime.start();

        expect(createdWindow).toBeDefined();
        expect(createdWindow!.id).toBeGreaterThan(0);
        expect(gotWindow).toBe(createdWindow);
    });

    it("ctx.createWindow throws without window manager injection", async () => {
        let error: Error | undefined;

        const feature = createFeature({
            id: "app",
            onActivate(ctx) {
                try {
                    ctx.createWindow("main");
                } catch (e) {
                    error = e as Error;
                }
            },
        });

        const runtime = createRuntime({
            features: [feature],
            logger: { handlers: [] },
        });

        // No _injectWindowManager call
        await runtime.start();

        expect(error).toBeDefined();
        expect(error!.message).toContain("Window manager not available");
    });

    it("destroys all windows on runtime shutdown", async () => {
        const factory = stubFactory();
        const windowManager = new WindowManager(factory);
        windowManager.registerDefinition(stubDefinition("splash"));

        let windowDestroyed = false;
        (factory.create as ReturnType<typeof vi.fn>).mockImplementation((): BaseWindow => {
            return {
                id: 1,
                isDestroyed: () => windowDestroyed,
                close: vi.fn(),
                show: vi.fn(),
                destroy: vi.fn(() => {
                    windowDestroyed = true;
                }),
            } as unknown as BaseWindow;
        });

        const feature = createFeature({
            id: "app",
            onActivate(ctx) {
                ctx.createWindow("splash");
            },
        });

        const runtime = createRuntime({
            features: [feature],
            logger: { handlers: [] },
        });
        runtime._injectWindowManager(windowManager);

        await runtime.start();
        expect(windowDestroyed).toBe(false);

        await runtime.shutdown();
        expect(windowDestroyed).toBe(true);
    });

    it("created window has load() method", async () => {
        const factory = stubFactory();
        const windowManager = new WindowManager(factory);
        windowManager.registerDefinition(stubDefinition("main"));

        let createdWindow: ElectroWindow | undefined;

        const appFeature = createFeature({
            id: "app",
            onActivate(ctx) {
                createdWindow = ctx.createWindow("main") as ElectroWindow;
            },
        });

        const runtime = createRuntime({
            features: [appFeature],
            logger: { handlers: [] },
        });

        runtime._injectWindowManager(windowManager);
        await runtime.start();

        expect(createdWindow).toBeDefined();
        expect(typeof createdWindow!.load).toBe("function");
    });

    it("_injectWindowManager throws if runtime already started", async () => {
        const factory = stubFactory();
        const windowManager = new WindowManager(factory);

        const runtime = createRuntime({
            features: [createFeature({ id: "app" })],
            logger: { handlers: [] },
        });

        await runtime.start();

        expect(() => runtime._injectWindowManager(windowManager)).toThrow();
    });
});
