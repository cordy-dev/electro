import type { LogEntry } from "./types";

const dim = "\x1b[90m";
const cyan = "\x1b[36m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const magenta = "\x1b[35m";
const reset = "\x1b[0m";

function formatTime(ts: number): string {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function colorizeValue(value: unknown): string {
    if (value === null) return `${magenta}null${reset}`;
    if (value === undefined) return `${dim}undefined${reset}`;
    if (typeof value === "string") return `${green}"${value}"${reset}`;
    if (typeof value === "number") return `${yellow}${value}${reset}`;
    if (typeof value === "boolean") return `${yellow}${value}${reset}`;
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const items = value.map(colorizeValue).join(`${dim},${reset} `);
        return `[${items}]`;
    }
    if (typeof value === "object") {
        const entries = Object.entries(value);
        if (entries.length === 0) return "{}";
        const pairs = entries.map(([k, v]) => `${cyan}${k}${reset}${dim}:${reset} ${colorizeValue(v)}`);
        return `${dim}{${reset} ${pairs.join(`${dim},${reset} `)} ${dim}}${reset}`;
    }
    return String(value);
}

export function createConsoleHandler(): (entry: LogEntry) => void {
    return (entry: LogEntry) => {
        const time = formatTime(entry.timestamp);
        const tag = entry.level === "debug" ? "electro" : entry.level;
        const detailsPart = entry.details ? ` ${colorizeValue(entry.details)}` : "";
        const line = `${time} [${tag}] ${entry.code} \u2192 ${entry.message}${detailsPart}`;

        if (entry.level === "error") {
            console.error(line);
        } else if (entry.level === "warn") {
            console.warn(line);
        } else {
            console.log(line);
        }
    };
}
