export type StateMachineConfig<TState extends string> = {
    transitions: Record<TState, TState[]>;
    initial: TState;
    name?: string;
};

export type TransitionListener<TState extends string> = (from: TState, to: TState) => void;
