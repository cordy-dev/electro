/** Resolve the file path of the caller (skipping electro config internals). */
export function getCallerPath(): string | undefined {
    const stack = new Error().stack;
    if (!stack) return undefined;

    const lines = stack.split("\n");
    for (const line of lines) {
        const match = line.match(/(?:at\s+.*\()?((?:file:\/\/)?[^\s)]+):\d+:\d+\)?/);
        if (!match) continue;
        const rawPath = match[1];

        // Skip electro internal frames (source and bundled)
        if (
            rawPath.includes("/src/config/") ||
            rawPath.includes("/dist/config") ||
            rawPath.includes("@cordy/electro") ||
            rawPath.includes("/packages/electro/dist/")
        ) {
            continue;
        }

        if (rawPath.startsWith("file://")) {
            try {
                return decodeURIComponent(new URL(rawPath).pathname);
            } catch {
                return rawPath;
            }
        }

        return rawPath;
    }

    return undefined;
}
