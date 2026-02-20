import { describe, expect, it } from "vitest";
import { createFeature } from "../feature/helpers";
import { FeatureManager } from "../feature/manager";
import { ServiceScope } from "../service/enums";
import { createService } from "../service/helpers";
import type { LoggerContext } from "../types";
import { ViewManager } from "../view/manager";
import type { ElectroView, ViewInstance, ViewRegistryEntry } from "../view/types";
import { IpcBridge } from "./bridge";

interface IpcMainMock {
    handle(channel: string, listener: (event: { sender: { id: number } }, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
}

function createIpcMainMock(): { ipcMain: IpcMainMock; handlers: Map<string, (...args: unknown[]) => unknown> } {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    const ipcMain: IpcMainMock = {
        handle(channel, listener) {
            handlers.set(channel, listener as (...args: unknown[]) => unknown);
        },
        removeHandler(channel) {
            handlers.delete(channel);
        },
    };

    return { ipcMain, handlers };
}

function makeLogger(): LoggerContext {
    return {
        debug() {},
        warn() {},
        error() {},
    };
}

function makeViewInstance(id: string, webContentsId: number): ViewInstance {
    const view = {
        webContents: {
            id: webContentsId,
            isDestroyed: () => false,
        },
        load: async () => {},
    } as unknown as ElectroView;

    return {
        id,
        create: () => view,
        view: () => view,
        destroy: () => {},
    };
}

async function createStartedBridge(args: {
    viewRegistry: readonly ViewRegistryEntry[];
    viewWebContentsId: number;
    exposedScope?: ServiceScope;
}): Promise<{ bridge: IpcBridge; handlers: Map<string, (...args: unknown[]) => unknown> }> {
    const service = createService({
        id: "configuration",
        scope: args.exposedScope ?? ServiceScope.EXPOSED,
        api: () => ({
            getVersion: () => "1.0.0",
        }),
    });

    const feature = createFeature({
        id: "core",
        services: [service],
    });

    const featureManager = new FeatureManager(makeLogger());
    featureManager.register(feature);
    await featureManager.bootstrap();

    const viewManager = new ViewManager();
    viewManager.register(makeViewInstance("splash", args.viewWebContentsId));

    const { ipcMain, handlers } = createIpcMainMock();
    const bridge = new IpcBridge(featureManager, viewManager, args.viewRegistry, { ipcMain });
    await bridge.start();

    return { bridge, handlers };
}

describe("IpcBridge", () => {
    it("registers invoke handler for exposed service method", async () => {
        const { handlers } = await createStartedBridge({
            viewRegistry: [{ id: "splash", hasRenderer: true, features: ["core"] }],
            viewWebContentsId: 1,
        });

        const handler = handlers.get("core:configuration:getVersion");
        expect(handler).toBeDefined();

        const result = await handler!({ sender: { id: 1 } });
        expect(result).toBe("1.0.0");
    });

    it("denies invoke when view does not allow target feature", async () => {
        const { handlers } = await createStartedBridge({
            viewRegistry: [{ id: "splash", hasRenderer: true, features: ["settings"] }],
            viewWebContentsId: 1,
        });

        const handler = handlers.get("core:configuration:getVersion");
        await expect(handler!({ sender: { id: 1 } })).rejects.toThrow("Access denied");
    });

    it("does not register invoke handlers for non-exposed services", async () => {
        const { handlers } = await createStartedBridge({
            viewRegistry: [{ id: "splash", hasRenderer: true, features: ["core"] }],
            viewWebContentsId: 1,
            exposedScope: ServiceScope.INTERNAL,
        });

        expect(handlers.has("core:configuration:getVersion")).toBe(false);
    });

    it("removes all handlers on stop", async () => {
        const { bridge, handlers } = await createStartedBridge({
            viewRegistry: [{ id: "splash", hasRenderer: true, features: ["core"] }],
            viewWebContentsId: 1,
        });

        expect(handlers.size).toBeGreaterThan(0);
        bridge.stop();
        expect(handlers.size).toBe(0);
    });
});
