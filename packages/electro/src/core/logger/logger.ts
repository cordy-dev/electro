import type { LoggerContext } from "../types";
import type { LogEntry, LogHandler } from "./types";

export class Logger implements LoggerContext {
    private readonly handlers: Set<LogHandler> = new Set();

    addHandler(handler: LogHandler): void {
        this.handlers.add(handler);
    }

    removeHandler(handler: LogHandler): void {
        this.handlers.delete(handler);
    }

    debug(code: string, message: string, details?: Record<string, unknown>): void {
        this.emit("debug", code, message, details);
    }

    warn(code: string, message: string, details?: Record<string, unknown>): void {
        this.emit("warn", code, message, details);
    }

    error(code: string, message: string, details?: Record<string, unknown>): void {
        this.emit("error", code, message, details);
    }

    private emit(
        level: LogEntry["level"],
        code: string,
        message: string,
        details?: Record<string, unknown>,
    ): void {
        const entry: LogEntry = { level, code, message, details, timestamp: Date.now() };
        for (const handler of this.handlers) {
            handler(entry);
        }
    }
}
