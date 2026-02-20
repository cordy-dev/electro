import { defineView } from "@cordy/electro";
import { describe, expect, it, vi } from "vitest";
import { generate } from "./generator";
import type { ScanResult } from "./types";

/** Helper to build a minimal ScanResult for testing. */
function makeScanResult(overrides?: Partial<ScanResult>): ScanResult {
    return {
        windows: [],
        features: [
            {
                id: "billing",
                filePath: "/project/src/features/billing.ts",
                dependencies: ["core"],
                services: [
                    {
                        id: "payment",
                        scope: "exposed",
                        methods: ["create", "refund"],
                        filePath: "/project/src/features/billing/services/payment.ts",
                        varName: "paymentService",
                        exported: true,
                    },
                    {
                        id: "invoice",
                        scope: "exposed",
                        methods: ["get"],
                        filePath: "/project/src/features/billing/services/invoice.ts",
                        varName: "invoiceService",
                        exported: true,
                    },
                    {
                        id: "audit",
                        scope: "private",
                        methods: ["log"],
                        filePath: "/project/src/features/billing/services/audit.ts",
                        varName: "auditService",
                        exported: true,
                    },
                ],
                tasks: [
                    {
                        id: "sync-data",
                        varName: "syncTask",
                        filePath: "/project/src/features/billing/tasks/sync.ts",
                        exported: true,
                    },
                ],
                events: [
                    {
                        id: "payment-created",
                        varName: "paymentCreatedEvent",
                        filePath: "/project/src/features/billing/events/payment-created.ts",
                        exported: true,
                    },
                ],
                publishedEvents: ["payment-created"],
            },
            {
                id: "auth",
                filePath: "/project/src/features/auth.ts",
                dependencies: [],
                services: [
                    {
                        id: "session",
                        scope: "exposed",
                        methods: ["login", "logout"],
                        filePath: "/project/src/features/auth/services/session.ts",
                        varName: "sessionService",
                        exported: true,
                    },
                    {
                        id: "tokens",
                        scope: "internal",
                        methods: ["refresh"],
                        filePath: "/project/src/features/auth/services/tokens.ts",
                        varName: "tokensService",
                        exported: true,
                    },
                ],
                tasks: [],
                events: [],
                publishedEvents: [],
            },
            {
                id: "core",
                filePath: "/project/src/features/core.ts",
                dependencies: [],
                services: [],
                tasks: [],
                events: [],
                publishedEvents: ["ready"],
            },
        ],
        ...overrides,
    };
}

function makeView(name: string, features: string[]) {
    return defineView({ name, entry: `./src/${name}.html`, features });
}

const defaultInput = (overrides?: Partial<Parameters<typeof generate>[0]>) => ({
    scanResult: makeScanResult(),
    views: [makeView("main", ["billing", "auth", "core"])],
    outputDir: "/project/.electro",
    srcDir: "/project/src",
    ...overrides,
});

describe("generate()", () => {
    it("generates correct number of files", () => {
        const { files, envTypes } = generate(defaultInput());

        // 1 preload + 1 bridge types
        expect(files).toHaveLength(2);
        expect(files.map((f) => f.path)).toEqual(["generated/preload/main.gen.ts", "generated/views/main.bridge.d.ts"]);
        expect(envTypes.path).toBe("electro-env.d.ts");
    });

    it("generates preload with only exposed services", () => {
        const { files } = generate(defaultInput({ views: [makeView("main", ["billing"])] }));

        const preload = files.find((f) => f.path === "generated/preload/main.gen.ts")!;
        // Should include billing.payment and billing.invoice (exposed)
        expect(preload.content).toContain("billing:payment:create");
        expect(preload.content).toContain("billing:payment:refund");
        expect(preload.content).toContain("billing:invoice:get");
        // Should NOT include audit (private)
        expect(preload.content).not.toContain("audit");
    });

    it("respects view policy — denies unlisted features", () => {
        const { files } = generate(defaultInput({ views: [makeView("pip", ["core"])] }));

        const preload = files.find((f) => f.path === "generated/preload/pip.gen.ts")!;
        // Only core should be in the preload
        expect(preload.content).toContain("core");
        expect(preload.content).not.toContain("billing");
        expect(preload.content).not.toContain("auth");
    });

    it("generates per-view preloads with different allowed features", () => {
        const { files } = generate(
            defaultInput({ views: [makeView("main", ["billing", "auth", "core"]), makeView("pip", ["core"])] }),
        );

        // 2 views × 2 files = 4
        expect(files).toHaveLength(4);

        const mainPreload = files.find((f) => f.path === "generated/preload/main.gen.ts")!;
        const pipPreload = files.find((f) => f.path === "generated/preload/pip.gen.ts")!;

        expect(mainPreload.content).toContain("billing");
        expect(pipPreload.content).not.toContain("billing");
    });

    it("generates bridge types with correct structure", () => {
        const { files } = generate(defaultInput({ views: [makeView("main", ["billing"])] }));

        const bridge = files.find((f) => f.path === "generated/views/main.bridge.d.ts")!;
        expect(bridge.content).toContain("interface ElectroBridge");
        expect(bridge.content).not.toContain("interface Window");
        expect(bridge.content).not.toContain("electro: ElectroBridge");
        expect(bridge.content).toContain("create(...args: unknown[]): Promise<unknown>");
        expect(bridge.content).toContain("refund(...args: unknown[]): Promise<unknown>");
    });

    it("generates FeatureMap with per-feature services", () => {
        const { envTypes } = generate(defaultInput({ views: [makeView("main", ["billing"])] }));

        expect(envTypes.content).toContain('declare module "@cordy/electro"');
        expect(envTypes.content).toContain("interface FeatureMap");
        // billing feature has payment service with typeof import
        expect(envTypes.content).toContain('"payment": _SvcApi<typeof import(');
        expect(envTypes.content).toContain("paymentService");
    });

    it("generates FeatureMap with per-feature tasks", () => {
        const { envTypes } = generate(defaultInput({ views: [makeView("main", ["billing"])] }));

        expect(envTypes.content).toContain("interface FeatureMap");
        expect(envTypes.content).toContain('"sync-data"');
        expect(envTypes.content).toContain("syncTask");
    });

    it("generates FeatureMap with per-feature events", () => {
        const { envTypes } = generate(defaultInput());

        expect(envTypes.content).toContain('"payment-created"');
        expect(envTypes.content).toContain("paymentCreatedEvent");
        expect(envTypes.content).toContain("_EventPayload<typeof import(");
    });

    it("generates empty events object for features without events", () => {
        const { envTypes } = generate(defaultInput());

        // core has no events — should contain events: {};
        expect(envTypes.content).toContain("events: {};");
    });

    it("uses unknown fallback for non-exported events", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "f",
                            filePath: "/project/src/f.ts",
                            dependencies: [],
                            services: [],
                            tasks: [],
                            events: [
                                {
                                    id: "internal-evt",
                                    varName: "internalEvt",
                                    filePath: "/project/src/f.ts",
                                    exported: false,
                                },
                            ],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [],
            }),
        );

        expect(envTypes.content).toContain('"internal-evt": unknown');
        expect(envTypes.content).not.toContain("typeof import");
    });

    it("generates FeatureMap entries for all features", () => {
        const { envTypes } = generate(defaultInput({ views: [makeView("main", ["billing"])] }));

        expect(envTypes.content).toContain("interface FeatureMap");
        expect(envTypes.content).toContain('"billing"');
        expect(envTypes.content).toContain('"auth"');
        expect(envTypes.content).toContain('"core"');
    });

    it("generates dependencies as string union", () => {
        const { envTypes } = generate(defaultInput());

        // billing depends on core
        expect(envTypes.content).toContain('dependencies: "core"');
        // auth has no dependencies
        expect(envTypes.content).toContain("dependencies: never");
    });

    it("uses unknown fallback for non-exported services", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "f",
                            filePath: "/project/src/f.ts",
                            dependencies: [],
                            services: [
                                {
                                    id: "local",
                                    scope: "private",
                                    methods: ["run"],
                                    filePath: "/project/src/f.ts",
                                    varName: "localSvc",
                                    exported: false,
                                },
                            ],
                            tasks: [],
                            events: [],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [makeView("main", [])],
            }),
        );

        expect(envTypes.content).toContain('"local"');
        expect(envTypes.content).toContain('"local": unknown');
        expect(envTypes.content).not.toContain("typeof import");
    });

    it("uses void payload for non-exported tasks", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "f",
                            filePath: "/project/src/f.ts",
                            dependencies: [],
                            services: [],
                            tasks: [
                                {
                                    id: "bg-job",
                                    varName: "bgTask",
                                    filePath: "/project/src/f/tasks/bg.ts",
                                    exported: false,
                                },
                            ],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [makeView("main", [])],
            }),
        );

        expect(envTypes.content).toContain('"bg-job"');
        // Non-exported: no typeof import() reference, just void payload
        expect(envTypes.content).toContain('"bg-job": void;');
        expect(envTypes.content).not.toContain("typeof import");
    });

    it("calculates correct relative paths from srcDir to source files", () => {
        const { envTypes } = generate(defaultInput({ views: [makeView("main", ["billing"])] }));

        // src/electro-env.d.ts → src/features/billing/services/payment.ts
        expect(envTypes.content).toContain('./features/billing/services/payment"');
    });

    it("handles empty features list for feature types", () => {
        const { envTypes } = generate(
            defaultInput({ scanResult: { features: [], windows: [] }, views: [makeView("main", [])] }),
        );

        expect(envTypes.content).toContain("interface FeatureMap {}");
        expect(envTypes.content).toContain("interface ServiceOwnerMap {}");
        expect(envTypes.content).toContain("interface TaskOwnerMap {}");
    });

    it("generates empty namespace for features without exposed services", () => {
        const { files } = generate(defaultInput({ views: [makeView("main", ["core"])] }));

        const preload = files.find((f) => f.path === "generated/preload/main.gen.ts")!;
        expect(preload.content).toContain("core: {},");
    });

    it("includes preload extension import when specified", () => {
        const v = defineView({
            name: "main",
            entry: "./src/main.html",
            features: ["billing"],
            preload: "./extend.ts",
        });

        const { files } = generate(defaultInput({ views: [v] }));

        const preload = files.find((f) => f.path === "generated/preload/main.gen.ts")!;
        expect(preload.content).toContain('import "./extend.ts"');
    });

    it("handles empty features list", () => {
        const { files } = generate(
            defaultInput({ scanResult: { features: [], windows: [] }, views: [makeView("main", [])] }),
        );

        const preload = files.find((f) => f.path === "generated/preload/main.gen.ts")!;
        expect(preload.content).toContain('electro", {})');
    });

    it("adds auto-generated header to all files", () => {
        const { files, envTypes } = generate(defaultInput({ views: [makeView("main", ["billing"])] }));

        for (const file of [...files, envTypes]) {
            expect(file.content).toContain("Auto-generated by Electro codegen. Do not edit.");
        }
    });

    it("handles exposed service with no methods in preload and bridge", () => {
        const { files } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "empty",
                            filePath: "/project/src/empty.ts",
                            dependencies: [],
                            services: [
                                {
                                    id: "stub",
                                    scope: "exposed",
                                    methods: [],
                                    filePath: "/project/src/empty.ts",
                                    varName: "stubService",
                                    exported: true,
                                },
                            ],
                            tasks: [],
                            events: [],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [makeView("main", ["empty"])],
            }),
        );

        const preload = files.find((f) => f.path === "generated/preload/main.gen.ts")!;
        expect(preload.content).toContain("stub: {},");

        const bridge = files.find((f) => f.path === "generated/views/main.bridge.d.ts")!;
        expect(bridge.content).toContain("stub: Record<string, never>");
    });

    it("handles view with no features property", () => {
        const v = defineView({ name: "bare", entry: "./src/bare.html" });
        const { files } = generate(defaultInput({ views: [v] }));
        const preload = files.find((f) => f.path === "generated/preload/bare.gen.ts")!;
        expect(preload.content).not.toContain("billing");
        expect(preload.content).not.toContain("auth");
    });

    it("warns when view references unknown feature", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        generate(defaultInput({ views: [makeView("main", ["nonexistent"])] }));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown feature "nonexistent"'));
        warn.mockRestore();
    });

    it("deduplicates service ids within a feature (first wins)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "a",
                            filePath: "/project/src/a.ts",
                            dependencies: [],
                            services: [
                                {
                                    id: "shared",
                                    scope: "exposed",
                                    methods: ["run"],
                                    filePath: "/project/src/a.ts",
                                    varName: "sharedA",
                                    exported: true,
                                },
                                {
                                    id: "shared",
                                    scope: "internal",
                                    methods: ["exec"],
                                    filePath: "/project/src/a.ts",
                                    varName: "sharedB",
                                    exported: true,
                                },
                            ],
                            tasks: [],
                            events: [],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [],
            }),
        );

        // First wins: sharedA
        expect(envTypes.content).toContain("sharedA");
        expect(envTypes.content).not.toContain("sharedB");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Duplicate service id "shared"'));
        warn.mockRestore();
    });

    it("services in different features are kept separate", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "a",
                            filePath: "/project/src/a.ts",
                            dependencies: [],
                            services: [
                                {
                                    id: "store",
                                    scope: "exposed",
                                    methods: ["get"],
                                    filePath: "/project/src/a.ts",
                                    varName: "storeA",
                                    exported: true,
                                },
                            ],
                            tasks: [],
                            events: [],
                            publishedEvents: [],
                        },
                        {
                            id: "b",
                            filePath: "/project/src/b.ts",
                            dependencies: [],
                            services: [
                                {
                                    id: "store",
                                    scope: "internal",
                                    methods: ["set"],
                                    filePath: "/project/src/b.ts",
                                    varName: "storeB",
                                    exported: true,
                                },
                            ],
                            tasks: [],
                            events: [],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [],
            }),
        );

        // Both features keep their own "store" service
        expect(envTypes.content).toContain("storeA");
        expect(envTypes.content).toContain("storeB");
    });

    it("features with empty object for empty services/tasks", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "minimal",
                            filePath: "/project/src/minimal.ts",
                            dependencies: [],
                            services: [],
                            tasks: [],
                            events: [],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [],
            }),
        );

        expect(envTypes.content).toContain('"minimal"');
        expect(envTypes.content).toContain("services: {};");
        expect(envTypes.content).toContain("tasks: {};");
        expect(envTypes.content).toContain("events: {};");
        expect(envTypes.content).toContain("dependencies: never");
    });

    it("generates ServiceOwnerMap mapping services to features", () => {
        const { envTypes } = generate(defaultInput());

        expect(envTypes.content).toContain("interface ServiceOwnerMap");
        // billing owns payment, invoice, audit
        expect(envTypes.content).toContain('"payment": "billing"');
        expect(envTypes.content).toContain('"invoice": "billing"');
        expect(envTypes.content).toContain('"audit": "billing"');
        // auth owns session, tokens
        expect(envTypes.content).toContain('"session": "auth"');
        expect(envTypes.content).toContain('"tokens": "auth"');
    });

    it("generates TaskOwnerMap mapping tasks to features", () => {
        const { envTypes } = generate(defaultInput());

        expect(envTypes.content).toContain("interface TaskOwnerMap");
        expect(envTypes.content).toContain('"sync-data": "billing"');
    });

    it("generates empty owner maps when no services/tasks", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    features: [
                        {
                            id: "minimal",
                            filePath: "/project/src/minimal.ts",
                            dependencies: [],
                            services: [],
                            tasks: [],
                            events: [],
                            publishedEvents: [],
                        },
                    ],
                },
                views: [],
            }),
        );

        expect(envTypes.content).toContain("interface ServiceOwnerMap {}");
        expect(envTypes.content).toContain("interface TaskOwnerMap {}");
    });

    it("scan + generate produces valid feature types", () => {
        const scanResult = makeScanResult();
        const { envTypes } = generate(
            defaultInput({
                scanResult,
                views: [makeView("main", ["billing"])],
            }),
        );

        // Services
        expect(envTypes.content).toContain('"payment"');
        // Tasks
        expect(envTypes.content).toContain('"sync-data"');
        // Features
        expect(envTypes.content).toContain('"core"');
        expect(envTypes.content).toContain('"billing"');
        // FeatureMap present
        expect(envTypes.content).toContain("interface FeatureMap");
        // Owner maps
        expect(envTypes.content).toContain("interface ServiceOwnerMap");
        expect(envTypes.content).toContain("interface TaskOwnerMap");
    });

    // ── WindowApiMap generation ────────────────────────────────────

    it("generates WindowApiMap for scanned windows", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    ...makeScanResult(),
                    windows: [
                        {
                            id: "splash",
                            varName: "splashWindow",
                            filePath: "/project/src/windows/splash.ts",
                            exported: true,
                        },
                        { id: "main", varName: "mainWindow", filePath: "/project/src/windows/main.ts", exported: true },
                    ],
                },
            }),
        );
        expect(envTypes.content).toContain("interface WindowApiMap");
        expect(envTypes.content).toContain('"splash": _WinApi<typeof import("./windows/splash").splashWindow>');
        expect(envTypes.content).toContain('"main": _WinApi<typeof import("./windows/main").mainWindow>');
    });

    it("uses unknown fallback for non-exported windows", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: {
                    ...makeScanResult(),
                    windows: [
                        {
                            id: "hidden",
                            varName: "hiddenWin",
                            filePath: "/project/src/windows/hidden.ts",
                            exported: false,
                        },
                    ],
                },
            }),
        );
        expect(envTypes.content).toContain('"hidden": unknown');
    });

    it("omits WindowApiMap when no windows scanned", () => {
        const { envTypes } = generate(
            defaultInput({
                scanResult: { ...makeScanResult(), windows: [] },
            }),
        );
        expect(envTypes.content).not.toContain("interface WindowApiMap");
    });

    it("includes _WinApi utility type in header", () => {
        const { envTypes } = generate(defaultInput());
        expect(envTypes.content).toContain("type _WinApi<T>");
    });
});
