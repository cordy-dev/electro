export type LogLevel = "debug" | "warn" | "error";

export type LogEntry = {
    level: LogLevel;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: number;
};

export type LogHandler = (entry: LogEntry) => void;
