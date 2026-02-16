import { describe, expect, it, vi } from "vitest";
import type { LoggerContext } from "../types";
import { FeatureStatus } from "./enums";
import { Feature } from "./feature";
import { FeatureHandle } from "./handle";
import { FeatureManager } from "./manager";

function mockLogger(): LoggerContext {
    return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("FeatureHandle", () => {
    it("status() returns current feature status", () => {
        const feature = new Feature({ id: "f1" }, mockLogger());
        feature.transition(FeatureStatus.REGISTERED);
        const handle = new FeatureHandle(feature, {} as FeatureManager);
        expect(handle.status()).toBe(FeatureStatus.REGISTERED);
    });

    it("status() reflects state changes", async () => {
        const mgr = new FeatureManager(mockLogger());
        mgr.register({ id: "f1" });
        await mgr.bootstrap();
        const feature = mgr.get("f1")!;
        const handle = new FeatureHandle(feature, mgr);
        expect(handle.status()).toBe(FeatureStatus.ACTIVATED);
    });

    it("enable() delegates to manager.enable(id)", async () => {
        const mgr = new FeatureManager(mockLogger());
        mgr.register({ id: "f1" });
        await mgr.bootstrap();
        await mgr.disable("f1");
        const feature = mgr.get("f1")!;
        const handle = new FeatureHandle(feature, mgr);
        expect(handle.status()).toBe(FeatureStatus.DEACTIVATED);
        await handle.enable();
        expect(handle.status()).toBe(FeatureStatus.ACTIVATED);
    });

    it("disable() delegates to manager.disable(id)", async () => {
        const mgr = new FeatureManager(mockLogger());
        mgr.register({ id: "f1" });
        await mgr.bootstrap();
        const feature = mgr.get("f1")!;
        const handle = new FeatureHandle(feature, mgr);
        await handle.disable();
        expect(handle.status()).toBe(FeatureStatus.DEACTIVATED);
    });
});
