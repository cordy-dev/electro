import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { scan } from "./scanner";

/** Create a temp dir with given files, run scan, clean up. */
async function scanFixture(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "electro-scan-"));
    try {
        for (const [name, content] of Object.entries(files)) {
            writeFileSync(join(dir, name), content);
        }
        return await scan(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ── Shared fixture: billing (3 services, 3 tasks, depends on core),
//    core (no services/tasks, publishes "ready"), analytics (no services) ──

const MULTI_FEATURE_FIXTURE = {
    "features.ts": `
const paymentService = createService({
    id: "payment",
    scope: "exposed",
    api: () => ({ create() {}, refund() {} }),
});
const auditService = createService({
    id: "audit",
    scope: "private",
    api: () => ({ log() {}, entries() {} }),
});
const usersService = createService({
    id: "users",
    scope: "internal",
    api: () => ({ add() {}, list() {} }),
});

const syncTask = createTask({ id: "sync-data", execute: async () => {} });
const reportTask = createTask({ id: "report", execute: async () => {} });
const cleanupTask = createTask({ id: "cleanup", execute: async () => {} });

createFeature({
    id: "billing",
    dependencies: ["core"],
    services: [paymentService, auditService, usersService],
    tasks: [syncTask, reportTask, cleanupTask],
    onActivate(ctx) {
        ctx.events.publish("invoice-created");
    },
});

createFeature({
    id: "core",
    dependencies: [],
    onActivate(ctx) {
        ctx.events.publish("ready");
    },
});

createFeature({
    id: "analytics",
    dependencies: ["core"],
});
`,
};

describe("scan()", () => {
    it("discovers features from source files", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const ids = result.features.map((f) => f.id);
        expect(ids).toContain("core");
        expect(ids).toContain("billing");
        expect(ids).toContain("analytics");
    });

    it("extracts feature dependencies", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const billing = result.features.find((f) => f.id === "billing")!;
        expect(billing.dependencies).toEqual(["core"]);

        const core = result.features.find((f) => f.id === "core")!;
        expect(core.dependencies).toEqual([]);
    });

    it("extracts services with correct scope", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const billing = result.features.find((f) => f.id === "billing")!;

        expect(billing.services).toHaveLength(3);

        const payment = billing.services.find((s) => s.id === "payment")!;
        expect(payment.scope).toBe("exposed");

        const audit = billing.services.find((s) => s.id === "audit")!;
        expect(audit.scope).toBe("private");

        const users = billing.services.find((s) => s.id === "users")!;
        expect(users.scope).toBe("internal");
    });

    it("extracts method names from api() return objects", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const billing = result.features.find((f) => f.id === "billing")!;

        const payment = billing.services.find((s) => s.id === "payment")!;
        expect(payment.methods).toEqual(["create", "refund"]);

        const audit = billing.services.find((s) => s.id === "audit")!;
        expect(audit.methods).toEqual(["log", "entries"]);

        const users = billing.services.find((s) => s.id === "users")!;
        expect(users.methods).toEqual(["add", "list"]);
    });

    it("extracts published events", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const core = result.features.find((f) => f.id === "core")!;
        expect(core.publishedEvents).toContain("ready");
    });

    it("features without services have empty services array", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const core = result.features.find((f) => f.id === "core")!;
        expect(core.services).toEqual([]);

        const analytics = result.features.find((f) => f.id === "analytics")!;
        expect(analytics.services).toEqual([]);
    });

    it("includes filePath on features and services", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        for (const feature of result.features) {
            expect(feature.filePath).toContain("features.ts");
        }
        const billing = result.features.find((f) => f.id === "billing")!;
        for (const service of billing.services) {
            expect(service.filePath).toContain("features.ts");
        }
    });

    it("excludes .d.ts, .spec.ts, .test.ts, .gen.ts files", async () => {
        const result = await scanFixture({
            "feature.ts": `createFeature({ id: "real", dependencies: [] });`,
            "feature.d.ts": `createFeature({ id: "decl", dependencies: [] });`,
            "feature.spec.ts": `createFeature({ id: "spec", dependencies: [] });`,
            "feature.test.ts": `createFeature({ id: "test", dependencies: [] });`,
            "feature.gen.ts": `createFeature({ id: "gen", dependencies: [] });`,
        });
        const ids = result.features.map((f) => f.id);
        expect(ids).toEqual(["real"]);
    });

    it("warns on parse errors and continues", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "broken.ts": `const x: = ;; broken syntax`,
            "valid.ts": `createFeature({ id: "ok", dependencies: [] });`,
        });
        expect(result.features.map((f) => f.id)).toContain("ok");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("[scanner] Parse error"));
        warn.mockRestore();
    });

    it("warns when feature references unknown service variable", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                createFeature({ id: "app", dependencies: [], services: [ghost] });
            `,
        });
        expect(result.features[0].services).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown service variable"));
        warn.mockRestore();
    });

    it("skips createService with non-literal id", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await scanFixture({
            "feat.ts": `const svc = createService({ id: someVar, scope: "exposed", api: () => ({}) });`,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-literal id"));
        warn.mockRestore();
    });

    it("skips createService with unresolvable scope", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await scanFixture({
            "feat.ts": `const svc = createService({ id: "x", scope: computedScope, api: () => ({}) });`,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unresolvable scope"));
        warn.mockRestore();
    });

    it("skips createFeature with non-literal id", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `createFeature({ id: dynamicId, dependencies: [] });`,
        });
        expect(result.features).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-literal id"));
        warn.mockRestore();
    });

    it("extracts methods from block-body arrow function", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "blk",
                    scope: "exposed",
                    api: () => { return { doStuff() {}, other() {} } },
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        const svc = result.features[0].services[0];
        expect(svc.methods).toEqual(["doStuff", "other"]);
    });

    it("extracts methods from function expression", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "fn",
                    scope: "exposed",
                    api: function() { return { alpha() {}, beta() {} } },
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        const svc = result.features[0].services[0];
        expect(svc.methods).toEqual(["alpha", "beta"]);
    });

    it("returns empty methods when arrow returns non-object expression", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "call",
                    scope: "exposed",
                    api: () => someCall(),
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].methods).toEqual([]);
        warn.mockRestore();
    });

    it("returns empty methods when api is not a function", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "bad",
                    scope: "exposed",
                    api: someVariable,
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].methods).toEqual([]);
        warn.mockRestore();
    });

    it("returns empty result for directory with no TS files", async () => {
        const result = await scanFixture({});
        expect(result.features).toEqual([]);
    });

    it("extracts methods from expression-body arrow function", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "expr",
                    scope: "exposed",
                    api: () => ({ ping() {}, pong() {} }),
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        const svc = result.features[0].services[0];
        expect(svc.methods).toEqual(["ping", "pong"]);
    });

    it("handles createService without scope property", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `const svc = createService({ id: "noscp" });`,
        });
        expect(result.features).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unresolvable scope"));
        warn.mockRestore();
    });

    it("handles createService without api property", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({ id: "noapi", scope: "exposed" });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].methods).toEqual([]);
    });

    it("handles createFeature called with non-object argument", async () => {
        const result = await scanFixture({
            "feat.ts": `createFeature(someVariable);`,
        });
        expect(result.features).toEqual([]);
    });

    it("ignores non-identifier elements in services array", async () => {
        const result = await scanFixture({
            "feat.ts": `
                createFeature({ id: "f", dependencies: [], services: [123, "str"] });
            `,
        });
        expect(result.features[0].services).toEqual([]);
    });

    it("handles unknown enum member in scope", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await scanFixture({
            "feat.ts": `const svc = createService({ id: "x", scope: ServiceScope.UNKNOWN });`,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unresolvable scope"));
        warn.mockRestore();
    });

    it("ignores publish() with no args or non-literal event name", async () => {
        const result = await scanFixture({
            "feat.ts": `
                ctx.events.publish();
                ctx.events.publish(dynamicName);
                ctx.events.publish("valid");
                createFeature({ id: "f", dependencies: [] });
            `,
        });
        expect(result.features[0].publishedEvents).toEqual(["valid"]);
    });

    it("handles createService with non-object argument", async () => {
        const result = await scanFixture({
            "feat.ts": `const svc = createService(someVar);`,
        });
        expect(result.features).toEqual([]);
    });

    it("falls back to service id when declarator uses destructuring", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const { api } = createService({ id: "destr", scope: "exposed", api: () => ({ run() {} }) });
            `,
        });
        // Uses id "destr" as varName fallback, but can't be referenced from feature's services array
        expect(result.features).toEqual([]);
    });

    it("returns empty methods when block body has no return with object", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "noret",
                    scope: "exposed",
                    api: () => { console.log("no return") },
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].methods).toEqual([]);
        warn.mockRestore();
    });

    it("skips spread elements in config object properties", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const defaults = {};
                const svc = createService({ ...defaults, id: "sp", scope: "exposed", api: () => ({ run() {} }) });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].id).toBe("sp");
        expect(result.features[0].services[0].methods).toEqual(["run"]);
        warn.mockRestore();
    });

    it("skips spread elements in api return object", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const base = {};
                const svc = createService({
                    id: "mix",
                    scope: "exposed",
                    api: () => ({ ...base, hello() {} }),
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].methods).toEqual(["hello"]);
        warn.mockRestore();
    });

    it("returns empty methods when block body returns non-object", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "retcall",
                    scope: "exposed",
                    api: () => { return someCall() },
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].methods).toEqual([]);
        warn.mockRestore();
    });

    it("skips non-identifier property keys in api return object", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "litkey",
                    scope: "exposed",
                    api: () => ({ "string-key"() {}, normal() {} }),
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        // "string-key" uses a Literal key node, not Identifier — skipped
        expect(result.features[0].services[0].methods).toEqual(["normal"]);
        warn.mockRestore();
    });

    it("handles createService with missing id property", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await scanFixture({
            "feat.ts": `const svc = createService({ scope: "exposed" });`,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-literal id"));
        warn.mockRestore();
    });

    it("includes varName on scanned services", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const paymentService = createService({
                    id: "payment",
                    scope: "exposed",
                    api: () => ({ charge() {} }),
                });
                createFeature({ id: "billing", dependencies: [], services: [paymentService] });
            `,
        });
        const billing = result.features.find((f) => f.id === "billing")!;
        const payment = billing.services.find((s) => s.id === "payment")!;
        expect(payment.varName).toBe("paymentService");
        expect(payment.exported).toBe(false);
    });

    it("detects exported services", async () => {
        const result = await scanFixture({
            "feat.ts": `
                export const svc = createService({ id: "pub", scope: "exposed", api: () => ({ run() {} }) });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].exported).toBe(true);
    });

    it("detects non-exported services", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({ id: "priv", scope: "exposed", api: () => ({ run() {} }) });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].exported).toBe(false);
    });

    it("detects export { name } re-export pattern", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({ id: "re", scope: "exposed", api: () => ({ run() {} }) });
                export { svc };
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].exported).toBe(true);
    });

    it("handles non-literal elements in dependencies array", async () => {
        const result = await scanFixture({
            "feat.ts": `createFeature({ id: "f", dependencies: [someVar, "literal"] });`,
        });
        // someVar is filtered out (non-literal), only "literal" kept
        expect(result.features[0].dependencies).toEqual(["literal"]);
    });

    it("returns empty methods when function expression returns non-object", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `
                const svc = createService({
                    id: "fnret",
                    scope: "exposed",
                    api: function() { return someCall() },
                });
                createFeature({ id: "f", dependencies: [], services: [svc] });
            `,
        });
        expect(result.features[0].services[0].methods).toEqual([]);
        warn.mockRestore();
    });

    it("extracts tasks from features", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const billing = result.features.find((f) => f.id === "billing")!;
        expect(billing.tasks).toHaveLength(3);

        const sync = billing.tasks.find((t) => t.id === "sync-data")!;
        expect(sync.varName).toBe("syncTask");
        expect(sync.filePath).toContain("features.ts");
    });

    it("features without tasks have empty tasks array", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const core = result.features.find((f) => f.id === "core")!;
        expect(core.tasks).toEqual([]);
    });

    it("detects exported tasks", async () => {
        const result = await scanFixture({
            "feat.ts": `
                export const t = createTask({ id: "job", execute: async () => {} });
                createFeature({ id: "f", dependencies: [], tasks: [t] });
            `,
        });
        expect(result.features[0].tasks[0].exported).toBe(true);
    });

    it("warns when feature references unknown task variable", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `createFeature({ id: "f", dependencies: [], tasks: [ghost] });`,
        });
        expect(result.features[0].tasks).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown task variable"));
        warn.mockRestore();
    });

    it("skips createTask with non-literal id", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await scanFixture({
            "feat.ts": `const t = createTask({ id: someVar, execute: async () => {} });`,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-literal id"));
        warn.mockRestore();
    });

    it("extracts events from features", async () => {
        const result = await scanFixture({
            "feat.ts": `
                export const readyEvent = createEvent("ready");
                export const loadedEvent = createEvent("loaded");
                createFeature({ id: "app", dependencies: [], events: [readyEvent, loadedEvent] });
            `,
        });
        const app = result.features.find((f) => f.id === "app")!;
        expect(app.events).toHaveLength(2);
        expect(app.events[0].id).toBe("ready");
        expect(app.events[0].varName).toBe("readyEvent");
        expect(app.events[0].exported).toBe(true);
        expect(app.events[1].id).toBe("loaded");
    });

    it("features without events have empty events array", async () => {
        const result = await scanFixture(MULTI_FEATURE_FIXTURE);
        const core = result.features.find((f) => f.id === "core")!;
        expect(core.events).toEqual([]);
    });

    it("detects exported events", async () => {
        const result = await scanFixture({
            "feat.ts": `
                export const evt = createEvent("ping");
                createFeature({ id: "f", dependencies: [], events: [evt] });
            `,
        });
        expect(result.features[0].events[0].exported).toBe(true);
    });

    it("detects non-exported events", async () => {
        const result = await scanFixture({
            "feat.ts": `
                const evt = createEvent("ping");
                createFeature({ id: "f", dependencies: [], events: [evt] });
            `,
        });
        expect(result.features[0].events[0].exported).toBe(false);
    });

    it("warns when feature references unknown event variable", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = await scanFixture({
            "feat.ts": `createFeature({ id: "f", dependencies: [], events: [ghost] });`,
        });
        expect(result.features[0].events).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown event variable"));
        warn.mockRestore();
    });

    it("skips createEvent with non-literal id", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await scanFixture({
            "feat.ts": `const evt = createEvent(dynamicId);`,
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-literal id"));
        warn.mockRestore();
    });
});
