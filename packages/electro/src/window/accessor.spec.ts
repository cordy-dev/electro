import { describe, expect, it, vi } from "vitest";
import { WindowAccessor } from "./accessor";
import type { WindowManager } from "./manager";
import type { ElectroWindow } from "./types";

let nextId = 1;

function stubBaseWindow(): ElectroWindow {
    return {
        id: nextId++,
        isDestroyed: () => false,
        close: vi.fn(),
        show: vi.fn(),
        destroy: vi.fn(),
        load: vi.fn(),
    } as unknown as ElectroWindow;
}

function stubWindowManager(overrides?: Partial<WindowManager>): WindowManager {
    return {
        registerDefinition: vi.fn(),
        hasDefinition: vi.fn(() => true),
        createWindow: vi.fn(() => stubBaseWindow()),
        getWindow: vi.fn(() => null),
        destroyWindow: vi.fn(),
        destroyAll: vi.fn(),
        list: vi.fn(() => []),
        ...overrides,
    } as unknown as WindowManager;
}

describe("WindowAccessor", () => {
    describe("createWindow", () => {
        it("delegates to WindowManager.createWindow", () => {
            const mgr = stubWindowManager();
            const accessor = new WindowAccessor(mgr);

            const win = accessor.createWindow("main");
            expect(mgr.createWindow).toHaveBeenCalledWith("main");
            expect(win.id).toBeGreaterThan(0);
        });

        it("propagates errors from WindowManager", () => {
            const mgr = stubWindowManager({
                createWindow: vi.fn(() => {
                    throw new Error("No definition");
                }),
            });
            const accessor = new WindowAccessor(mgr);

            expect(() => accessor.createWindow("unknown")).toThrow("No definition");
        });
    });

    describe("getWindow", () => {
        it("returns window from manager", () => {
            const win = stubBaseWindow();
            const mgr = stubWindowManager({
                getWindow: vi.fn(() => win),
            });
            const accessor = new WindowAccessor(mgr);

            expect(accessor.getWindow("main")).toBe(win);
        });

        it("returns null when window does not exist", () => {
            const mgr = stubWindowManager({
                getWindow: vi.fn(() => null),
            });
            const accessor = new WindowAccessor(mgr);

            expect(accessor.getWindow("main")).toBeNull();
        });
    });
});
