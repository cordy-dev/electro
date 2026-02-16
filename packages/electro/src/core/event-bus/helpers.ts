import type { CreatedEvent, EventId } from "./types";

/**
 * Creates a typed event definition.
 *
 * @overload Explicit generic — `createEvent<{ version: string }>("ready")`
 * @overload Infer from defaults — `createEvent("ready", { version: "unknown" })`
 */
export function createEvent<T = void>(id: EventId): CreatedEvent<T>;
export function createEvent<T>(id: EventId, defaults: T): CreatedEvent<T>;
export function createEvent<T>(id: EventId, defaults?: T): CreatedEvent<T> {
    if (!id || id.trim().length === 0) throw new Error("createEvent: id is required");
    return {
        id,
        defaults: defaults as T | undefined,
        payload() {
            throw new Error("phantom method — not callable");
        },
    };
}
