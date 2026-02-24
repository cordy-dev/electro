import type { FeatureManager } from "../feature/manager";
import { ServiceScope } from "../service/enums";
import type { ViewManager } from "../view/manager";
import type { ViewRegistryEntry } from "../view/types";

interface IpcMainLike {
    handle(channel: string, listener: (event: IpcInvokeEventLike, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
}

interface IpcInvokeEventLike {
    sender: {
        id: number;
    };
}

interface IpcBridgeOptions {
    ipcMain?: IpcMainLike | null;
}

/**
 * Registers invoke handlers for exposed service methods and enforces
 * per-view feature access at runtime.
 */
export class IpcBridge {
    private readonly viewFeatures = new Map<string, ReadonlySet<string>>();
    private readonly ipcMainOverride: IpcMainLike | null;
    private ipcMain: IpcMainLike | null = null;
    private readonly registeredChannels = new Set<string>();

    constructor(
        private readonly featureManager: FeatureManager,
        private readonly viewManager: ViewManager,
        viewRegistry: readonly ViewRegistryEntry[],
        options: IpcBridgeOptions = {},
    ) {
        this.ipcMainOverride = options.ipcMain ?? null;

        for (const entry of viewRegistry) {
            if (!entry.hasRenderer) continue;
            this.viewFeatures.set(entry.id, new Set(entry.features ?? []));
        }
    }

    async start(): Promise<void> {
        if (this.ipcMain) return;

        const ipcMain = this.ipcMainOverride ?? (await this.resolveIpcMain());
        if (!ipcMain) return;

        this.ipcMain = ipcMain;
        this.registerHandlers();
    }

    stop(): void {
        if (!this.ipcMain) return;

        for (const channel of this.registeredChannels) {
            this.ipcMain.removeHandler(channel);
        }
        this.registeredChannels.clear();
        this.ipcMain = null;
    }

    private async resolveIpcMain(): Promise<IpcMainLike | null> {
        if (!process.versions.electron) return null;

        try {
            const electron = await import("electron");
            const candidate = (electron as unknown as { ipcMain?: IpcMainLike }).ipcMain;
            if (!candidate) return null;
            if (typeof candidate.handle !== "function") return null;
            if (typeof candidate.removeHandler !== "function") return null;
            return candidate;
        } catch {
            return null;
        }
    }

    private registerHandlers(): void {
        if (!this.ipcMain) return;

        for (const feature of this.featureManager.list()) {
            for (const service of feature.config.services ?? []) {
                if (service.scope !== ServiceScope.EXPOSED) continue;

                const resolved = feature.serviceManager?.get(service.id);
                const api = resolved?.api;
                if (!api || typeof api !== "object") continue;

                for (const [method, target] of Object.entries(api as Record<string, unknown>)) {
                    if (typeof target !== "function") continue;

                    const channel = `${feature.id}:${service.id}:${method}`;
                    if (this.registeredChannels.has(channel)) continue;

                    this.ipcMain.handle(channel, async (event, ...args) => {
                        return this.invoke(event, feature.id, service.id, method, args);
                    });
                    this.registeredChannels.add(channel);
                }
            }
        }
    }

    private async invoke(
        event: IpcInvokeEventLike,
        featureId: string,
        serviceId: string,
        method: string,
        args: readonly unknown[],
    ): Promise<unknown> {
        this.assertAccess(event.sender.id, featureId, serviceId, method);

        const channel = `${featureId}:${serviceId}:${method}`;
        const feature = this.featureManager.get(featureId);
        const resolved = feature?.serviceManager?.get(serviceId);
        if (!resolved || resolved.scope !== ServiceScope.EXPOSED) {
            throw new Error(`No handler registered for '${channel}'`);
        }

        const api = resolved.api as Record<string, unknown>;
        const fn = api?.[method];
        if (typeof fn !== "function") {
            throw new Error(`No handler registered for '${channel}'`);
        }

        return await Promise.resolve(fn(...args));
    }

    private assertAccess(senderWebContentsId: number, featureId: string, serviceId: string, method: string): void {
        const viewId = this.resolveSenderViewId(senderWebContentsId);
        if (!viewId) {
            throw new Error(`Access denied for '${featureId}:${serviceId}:${method}': unknown renderer sender`);
        }

        const allowed = this.viewFeatures.get(viewId);
        if (!allowed?.has(featureId)) {
            throw new Error(`Access denied for '${featureId}:${serviceId}:${method}' from view '${viewId}'`);
        }
    }

    private resolveSenderViewId(senderWebContentsId: number): string | null {
        for (const viewId of this.viewFeatures.keys()) {
            const view = this.viewManager.get(viewId)?.view();
            if (!view || view.webContents.isDestroyed()) continue;
            if (view.webContents.id === senderWebContentsId) return viewId;
        }
        return null;
    }
}
