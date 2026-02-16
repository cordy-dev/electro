export type EventHandler = (payload: unknown) => void;

export type EventSubscription = {
    channel: string;
    handler: EventHandler;
    ownerId: string;
};

export type EventId = string;

/**
 * Type-erased event interface for heterogeneous collections.
 */
export interface EventInstance {
    readonly id: EventId;
    readonly defaults: unknown;
}

/**
 * Public interface returned by {@link createEvent}.
 *
 * Generic parameter preserves payload type for codegen inference
 * (`_EventPayload<T>` infers `T` from `payload()` phantom method).
 */
export interface CreatedEvent<T = void> extends EventInstance {
    readonly id: EventId;
    readonly defaults: T | undefined;
    /** @internal Phantom method for codegen type extraction. Never called. */
    payload(): T;
}
