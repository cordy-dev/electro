/**
 * Contract: Logger -- transport-based logging with pluggable handlers.
 *
 * Sections:
 *   1. Handler management
 *   2. Logging methods (debug, warn, error)
 *   3. Entry shape
 *   4. Console handler formatting
 */
import { describe, expect, it, vi } from "vitest";
import { createConsoleHandler } from "./console-handler";
import { Logger } from "./logger";
import type { LogEntry } from "./types";

describe("Logger", () => {
    // -- 1. Handler management --
    describe("Handler management", () => {
        it("addHandler registers a handler that receives entries", () => {
            const logger = new Logger();
            const handler = vi.fn();
            logger.addHandler(handler);
            logger.debug("test", "hello");
            expect(handler).toHaveBeenCalledOnce();
        });

        it("removeHandler stops the handler from receiving entries", () => {
            const logger = new Logger();
            const handler = vi.fn();
            logger.addHandler(handler);
            logger.removeHandler(handler);
            logger.debug("test", "hello");
            expect(handler).not.toHaveBeenCalled();
        });

        it("fans out to multiple handlers", () => {
            const logger = new Logger();
            const a = vi.fn();
            const b = vi.fn();
            logger.addHandler(a);
            logger.addHandler(b);
            logger.debug("test", "hello");
            expect(a).toHaveBeenCalledOnce();
            expect(b).toHaveBeenCalledOnce();
        });

        it("no handlers means no error (silent)", () => {
            const logger = new Logger();
            expect(() => logger.debug("test", "hello")).not.toThrow();
        });
    });

    // -- 2. Logging methods --
    describe("Logging methods", () => {
        it("debug() emits entry with level 'debug'", () => {
            const logger = new Logger();
            const handler = vi.fn();
            logger.addHandler(handler);
            logger.debug("auth", "initialized");
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ level: "debug", code: "auth", message: "initialized" }),
            );
        });

        it("warn() emits entry with level 'warn'", () => {
            const logger = new Logger();
            const handler = vi.fn();
            logger.addHandler(handler);
            logger.warn("payments", "degraded");
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({ level: "warn", code: "payments", message: "degraded" }),
            );
        });

        it("error() emits entry with level 'error'", () => {
            const logger = new Logger();
            const handler = vi.fn();
            logger.addHandler(handler);
            logger.error("auth", "failed", { reason: "timeout" });
            expect(handler).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: "error",
                    code: "auth",
                    message: "failed",
                    details: { reason: "timeout" },
                }),
            );
        });
    });

    // -- 3. Entry shape --
    describe("Entry shape", () => {
        it("includes timestamp as a number", () => {
            const logger = new Logger();
            let captured: LogEntry | undefined;
            logger.addHandler((entry) => {
                captured = entry;
            });
            logger.debug("test", "msg");
            expect(captured).toBeDefined();
            expect(typeof captured!.timestamp).toBe("number");
            expect(captured!.timestamp).toBeGreaterThan(0);
        });

        it("details is undefined when not provided", () => {
            const logger = new Logger();
            let captured: LogEntry | undefined;
            logger.addHandler((entry) => {
                captured = entry;
            });
            logger.debug("test", "msg");
            expect(captured!.details).toBeUndefined();
        });

        it("details is passed through when provided", () => {
            const logger = new Logger();
            let captured: LogEntry | undefined;
            logger.addHandler((entry) => {
                captured = entry;
            });
            logger.error("test", "msg", { key: "value" });
            expect(captured!.details).toEqual({ key: "value" });
        });
    });

    // -- 4. Console handler --
    describe("Console handler (createConsoleHandler)", () => {
        it("logs debug to console.log", () => {
            const spy = vi.spyOn(console, "log").mockImplementation(() => {});
            const handler = createConsoleHandler();
            handler({ level: "debug", code: "auth", message: "ready", timestamp: 0 });
            expect(spy).toHaveBeenCalledOnce();
            expect(spy.mock.calls[0]![0]).toContain("[electro]");
            expect(spy.mock.calls[0]![0]).toContain("auth");
            spy.mockRestore();
        });

        it("logs warn to console.warn", () => {
            const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const handler = createConsoleHandler();
            handler({ level: "warn", code: "payments", message: "slow", timestamp: 0 });
            expect(spy).toHaveBeenCalledOnce();
            expect(spy.mock.calls[0]![0]).toContain("[warn]");
            spy.mockRestore();
        });

        it("logs error to console.error", () => {
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            const handler = createConsoleHandler();
            handler({ level: "error", code: "db", message: "down", timestamp: 0 });
            expect(spy).toHaveBeenCalledOnce();
            expect(spy.mock.calls[0]![0]).toContain("[error]");
            spy.mockRestore();
        });
    });
});
