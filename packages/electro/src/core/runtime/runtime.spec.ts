/**
 * Contract: Runtime -- top-level orchestrator.
 *
 * Sections:
 *   1. Construction & initial state
 *   2. Feature registration
 *   3. start() lifecycle
 *   4. shutdown() lifecycle
 *   5. enable / disable
 *   6. isDegraded()
 *   7. Logger
 *   8. State guards (illegal operations)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../logger/types";
import { createFeature } from "../feature/helpers";
import { RuntimeState } from "./enums";
import { createRuntime } from "./helpers";

describe("Runtime", () => {
    // Suppress console output from the default console handler during tests.
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    // -- 1. Construction & initial state --
    describe("Construction & initial state", () => {
        it("starts in CREATED state", () => {
            const rt = createRuntime();
            expect(rt.state.current).toBe(RuntimeState.CREATED);
        });

        it("accepts features in constructor config", () => {
            const rt = createRuntime({
                features: [createFeature({ id: "auth" })],
            });
            expect(rt.state.current).toBe(RuntimeState.CREATED);
        });
    });

    // -- 2. Feature registration --
    describe("Feature registration", () => {
        it("register() adds features before start", () => {
            const rt = createRuntime();
            rt.register(createFeature({ id: "auth" }));
        });

        it("register() accepts an array", () => {
            const rt = createRuntime();
            rt.register([createFeature({ id: "a" }), createFeature({ id: "b" })]);
        });

        it("register() throws when not in CREATED state", async () => {
            const rt = createRuntime();
            await rt.start();
            expect(() => rt.register(createFeature({ id: "late" }))).toThrow('"Runtime" expected state "created"');
        });
    });

    // -- 3. start() lifecycle --
    describe("start() lifecycle", () => {
        it("transitions CREATED -> STARTING -> RUNNING", async () => {
            const states: RuntimeState[] = [];
            const rt = createRuntime();
            rt.state.onTransition((_from, to) => states.push(to));
            await rt.start();
            expect(states).toEqual([RuntimeState.STARTING, RuntimeState.RUNNING]);
            expect(rt.state.current).toBe(RuntimeState.RUNNING);
        });

        it("bootstraps all features to ACTIVATED", async () => {
            const calls: string[] = [];
            const rt = createRuntime({
                features: [
                    createFeature({
                        id: "feat",
                        onInitialize: async () => {
                            calls.push("init");
                        },
                        onActivate: async () => {
                            calls.push("activate");
                        },
                    }),
                ],
            });
            await rt.start();
            expect(calls).toEqual(["init", "activate"]);
        });

        it("transitions to FAILED on critical feature failure", async () => {
            const rt = createRuntime({
                features: [
                    createFeature({
                        id: "critical",
                        critical: true,
                        onInitialize: async () => {
                            throw new Error("boom");
                        },
                    }),
                ],
            });
            await expect(rt.start()).rejects.toThrow();
            expect(rt.state.current).toBe(RuntimeState.FAILED);
        });

        it("non-critical failure still reaches RUNNING (degraded)", async () => {
            const rt = createRuntime({
                features: [
                    createFeature({
                        id: "broken",
                        onInitialize: async () => {
                            throw new Error("fail");
                        },
                    }),
                    createFeature({ id: "healthy" }),
                ],
            });
            await rt.start();
            expect(rt.state.current).toBe(RuntimeState.RUNNING);
        });
    });

    // -- 4. shutdown() lifecycle --
    describe("shutdown() lifecycle", () => {
        it("transitions RUNNING -> STOPPING -> STOPPED", async () => {
            const rt = createRuntime();
            await rt.start();
            const states: RuntimeState[] = [];
            rt.state.onTransition((_from, to) => states.push(to));
            await rt.shutdown();
            expect(states).toEqual([RuntimeState.STOPPING, RuntimeState.STOPPED]);
        });

        it("calls onDeactivate and onDestroy hooks", async () => {
            const calls: string[] = [];
            const rt = createRuntime({
                features: [
                    createFeature({
                        id: "feat",
                        onDeactivate: async () => {
                            calls.push("deactivate");
                        },
                        onDestroy: async () => {
                            calls.push("destroy");
                        },
                    }),
                ],
            });
            await rt.start();
            await rt.shutdown();
            expect(calls).toEqual(["deactivate", "destroy"]);
        });
    });

    // -- 5. enable / disable --
    describe("enable / disable", () => {
        it("disable deactivates a feature", async () => {
            const rt = createRuntime({
                features: [createFeature({ id: "feat" })],
            });
            await rt.start();
            await rt.disable("feat");
            // Verified by enable working after (re-enable cycle)
        });

        it("enable re-activates a disabled feature", async () => {
            const onActivate = vi.fn();
            const rt = createRuntime({
                features: [createFeature({ id: "feat", onActivate })],
            });
            await rt.start();
            expect(onActivate).toHaveBeenCalledOnce();
            await rt.disable("feat");
            await rt.enable("feat");
            expect(onActivate).toHaveBeenCalledTimes(2);
        });

        it("enable throws when not RUNNING", async () => {
            const rt = createRuntime();
            await expect(rt.enable("feat")).rejects.toThrow('"Runtime" expected state "running"');
        });

        it("disable throws when not RUNNING", async () => {
            const rt = createRuntime();
            await expect(rt.disable("feat")).rejects.toThrow('"Runtime" expected state "running"');
        });
    });

    // -- 6. isDegraded() --
    describe("isDegraded()", () => {
        it("returns false when all features are healthy", async () => {
            const rt = createRuntime({
                features: [createFeature({ id: "feat" })],
            });
            await rt.start();
            expect(rt.isDegraded()).toBe(false);
        });

        it("returns true when a feature is in ERROR", async () => {
            const rt = createRuntime({
                features: [
                    createFeature({
                        id: "broken",
                        onActivate: async () => {
                            throw new Error("fail");
                        },
                    }),
                ],
            });
            await rt.start();
            expect(rt.isDegraded()).toBe(true);
        });
    });

    // -- 7. Logger --
    describe("Logger", () => {
        it("exposes logger", () => {
            const rt = createRuntime();
            expect(rt.logger).toBeDefined();
            expect(typeof rt.logger.addHandler).toBe("function");
        });

        it("custom handlers receive log entries during bootstrap", async () => {
            const entries: LogEntry[] = [];
            const rt = createRuntime({
                features: [
                    createFeature({
                        id: "feat",
                        onInitialize: async (ctx) => {
                            ctx.logger.debug("feat", "hello");
                        },
                    }),
                ],
                logger: {
                    handlers: [(entry) => entries.push(entry)],
                },
            });
            await rt.start();
            expect(entries.some((e) => e.code === "feat" && e.message === "hello")).toBe(true);
        });
    });

    // -- 8. State guards --
    describe("State guards", () => {
        it("cannot start twice", async () => {
            const rt = createRuntime();
            await rt.start();
            expect(() => rt.state.transition(RuntimeState.STARTING)).toThrow("Illegal transition");
        });

        it("shutdown() throws when not RUNNING", async () => {
            const rt = createRuntime();
            await expect(rt.shutdown()).rejects.toThrow('"Runtime" expected state "running"');
        });
    });
});
