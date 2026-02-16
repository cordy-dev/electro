/**
 * Contract: WindowManager — registry, creation, and lifecycle coordinator for windows.
 *
 * Responsibilities:
 *   - register window definitions (duplicate guard)
 *   - create windows via factory (singleton enforcement, multi allowed)
 *   - retrieve alive windows (auto-cleanup of destroyed)
 *   - destroy windows by name or all at once
 *   - list all tracked windows as WindowInfo snapshots
 *
 * Sections:
 *   1. registerDefinition / hasDefinition
 *   2. createWindow (singleton vs multi lifecycle)
 *   3. getWindow (retrieval + cleanup)
 *   4. destroyWindow
 *   5. destroyAll
 *   6. list
 */
import type { BaseWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { WindowDefinition } from "../config/types";
import { WindowManager } from "./manager";
import type { WindowFactory } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

let nextWindowId = 1;

function stubDefinition(name: string, overrides?: Partial<Pick<WindowDefinition, "lifecycle">>): WindowDefinition {
    return {
        name,
        entry: "./index.html",
        __source: "/fake/path",
        ...overrides,
    } as WindowDefinition;
}

function stubWindow(): BaseWindow {
    const id = nextWindowId++;
    let destroyed = false;
    return {
        id,
        isDestroyed: () => destroyed,
        close: vi.fn(),
        show: vi.fn(),
        destroy: () => {
            destroyed = true;
        },
    } as unknown as BaseWindow;
}

function stubFactory(): WindowFactory & { create: ReturnType<typeof vi.fn> } {
    return {
        create: vi.fn(() => stubWindow()),
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WindowManager", () => {
    // ── 1. registerDefinition / hasDefinition ─────────────────────────

    describe("registerDefinition", () => {
        it("stores a definition and makes it queryable via hasDefinition", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            const def = stubDefinition("main");

            mgr.registerDefinition(def);

            expect(mgr.hasDefinition("main")).toBe(true);
        });

        it("throws on duplicate name", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            const def = stubDefinition("main");

            mgr.registerDefinition(def);

            expect(() => mgr.registerDefinition(stubDefinition("main"))).toThrow("duplicate");
        });
    });

    describe("hasDefinition", () => {
        it("returns false for unregistered names", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);

            expect(mgr.hasDefinition("unknown")).toBe(false);
        });
    });

    // ── 2. createWindow ───────────────────────────────────────────────

    describe("createWindow", () => {
        it("creates a window from a registered definition", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            const win = mgr.createWindow("main");

            expect(win).toBeDefined();
            expect(win.id).toBeGreaterThan(0);
            expect(factory.create).toHaveBeenCalledOnce();
        });

        it("throws when no definition exists for the name", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);

            expect(() => mgr.createWindow("unknown")).toThrow("no definition");
        });

        it("throws when creating a duplicate singleton window", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main")); // default lifecycle = singleton

            mgr.createWindow("main");

            expect(() => mgr.createWindow("main")).toThrow("singleton");
        });

        it("allows re-creating a singleton after the previous one is destroyed", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            const win1 = mgr.createWindow("main");
            win1.destroy();

            const win2 = mgr.createWindow("main");
            expect(win2).toBeDefined();
            expect(win2.id).not.toBe(win1.id);
        });

        it("allows multiple instances for lifecycle='multi'", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("editor", { lifecycle: "multi" }));

            const win1 = mgr.createWindow("editor");
            const win2 = mgr.createWindow("editor");

            expect(win1.id).not.toBe(win2.id);
            expect(factory.create).toHaveBeenCalledTimes(2);
        });

        it("passes the definition to the factory", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            const def = stubDefinition("main");
            mgr.registerDefinition(def);

            mgr.createWindow("main");

            expect(factory.create).toHaveBeenCalledWith(def);
        });
    });

    // ── 3. getWindow ──────────────────────────────────────────────────

    describe("getWindow", () => {
        it("returns a created window by name", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            const created = mgr.createWindow("main");

            expect(mgr.getWindow("main")).toBe(created);
        });

        it("returns null for an unknown name", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);

            expect(mgr.getWindow("unknown")).toBeNull();
        });

        it("returns null for a registered name with no created window", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            expect(mgr.getWindow("main")).toBeNull();
        });

        it("returns null and cleans up when the only window is destroyed", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            const win = mgr.createWindow("main");
            win.destroy();

            expect(mgr.getWindow("main")).toBeNull();
        });

        it("returns first alive window for multi-instance, skipping destroyed ones", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("editor", { lifecycle: "multi" }));

            const win1 = mgr.createWindow("editor");
            const win2 = mgr.createWindow("editor");
            win1.destroy();

            expect(mgr.getWindow("editor")).toBe(win2);
        });
    });

    // ── 4. destroyWindow ──────────────────────────────────────────────

    describe("destroyWindow", () => {
        it("destroys all instances for a name", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("editor", { lifecycle: "multi" }));

            const win1 = mgr.createWindow("editor");
            const win2 = mgr.createWindow("editor");

            mgr.destroyWindow("editor");

            expect(win1.isDestroyed()).toBe(true);
            expect(win2.isDestroyed()).toBe(true);
            expect(mgr.getWindow("editor")).toBeNull();
        });

        it("allows re-creation after destruction", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            mgr.createWindow("main");
            mgr.destroyWindow("main");

            const win = mgr.createWindow("main");
            expect(win).toBeDefined();
            expect(win.isDestroyed()).toBe(false);
        });

        it("skips already-destroyed windows without error", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("editor", { lifecycle: "multi" }));

            const win1 = mgr.createWindow("editor");
            const win2 = mgr.createWindow("editor");
            win1.destroy(); // destroy before destroyWindow call

            expect(() => mgr.destroyWindow("editor")).not.toThrow();
            expect(win2.isDestroyed()).toBe(true);
        });

        it("is a no-op for unknown names", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);

            expect(() => mgr.destroyWindow("unknown")).not.toThrow();
        });
    });

    // ── 5. destroyAll ─────────────────────────────────────────────────

    describe("destroyAll", () => {
        it("destroys all tracked windows across all names", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));
            mgr.registerDefinition(stubDefinition("settings"));

            const win1 = mgr.createWindow("main");
            const win2 = mgr.createWindow("settings");

            mgr.destroyAll();

            expect(win1.isDestroyed()).toBe(true);
            expect(win2.isDestroyed()).toBe(true);
            expect(mgr.getWindow("main")).toBeNull();
            expect(mgr.getWindow("settings")).toBeNull();
        });

        it("is safe to call when no windows exist", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);

            expect(() => mgr.destroyAll()).not.toThrow();
        });
    });

    // ── 6. list ───────────────────────────────────────────────────────

    describe("list", () => {
        it("returns WindowInfo for all tracked windows", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));
            mgr.registerDefinition(stubDefinition("editor", { lifecycle: "multi" }));

            const win1 = mgr.createWindow("main");
            const win2 = mgr.createWindow("editor");
            const win3 = mgr.createWindow("editor");

            const infos = mgr.list();

            expect(infos).toHaveLength(3);
            expect(infos).toContainEqual({
                name: "main",
                windowId: win1.id,
                destroyed: false,
            });
            expect(infos).toContainEqual({
                name: "editor",
                windowId: win2.id,
                destroyed: false,
            });
            expect(infos).toContainEqual({
                name: "editor",
                windowId: win3.id,
                destroyed: false,
            });
        });

        it("reflects destroyed status in WindowInfo", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            const win = mgr.createWindow("main");
            win.destroy();

            const infos = mgr.list();
            expect(infos).toHaveLength(1);
            expect(infos[0]).toEqual({
                name: "main",
                windowId: win.id,
                destroyed: true,
            });
        });

        it("returns empty array when no windows are tracked", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);

            expect(mgr.list()).toEqual([]);
        });
    });

    // ── 7. load ──────────────────────────────────────────────────────

    describe("load()", () => {
        it("attaches load() to created windows", () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            const win = mgr.createWindow("main");

            expect(typeof win.load).toBe("function");
        });

        it("throws for BaseWindow (no loadURL)", async () => {
            const factory = stubFactory();
            const mgr = new WindowManager(factory);
            mgr.registerDefinition(stubDefinition("main"));

            const win = mgr.createWindow("main");

            await expect(win.load()).rejects.toThrow("browser-window");
        });

        it("calls loadURL in dev mode", async () => {
            const loadURL = vi.fn().mockResolvedValue(undefined);
            const factoryWithLoadURL: WindowFactory & { create: ReturnType<typeof vi.fn> } = {
                create: vi.fn(() => {
                    const id = nextWindowId++;
                    let destroyed = false;
                    return {
                        id,
                        isDestroyed: () => destroyed,
                        close: vi.fn(),
                        show: vi.fn(),
                        destroy: () => {
                            destroyed = true;
                        },
                        loadURL,
                    } as unknown as BaseWindow;
                }),
            };
            const mgr = new WindowManager(factoryWithLoadURL);
            mgr.registerDefinition(stubDefinition("main"));

            process.env.ELECTRO_DEV_URL_main = "http://localhost:5173";
            try {
                const win = mgr.createWindow("main");
                await win.load();
                expect(loadURL).toHaveBeenCalledWith("http://localhost:5173");
            } finally {
                delete process.env.ELECTRO_DEV_URL_main;
            }
        });
    });
});
