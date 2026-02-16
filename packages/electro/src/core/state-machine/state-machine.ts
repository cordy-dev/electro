import type { StateMachineConfig, TransitionListener } from "./types";

export class StateMachine<TState extends string> {
    private _current: TState;
    private readonly _transitions: Record<TState, TState[]>;
    private readonly _name: string;
    private readonly _listeners: Set<TransitionListener<TState>> = new Set();

    constructor(config: StateMachineConfig<TState>) {
        this._current = config.initial;
        this._transitions = config.transitions;
        this._name = config.name ?? "StateMachine";
    }

    get current(): TState {
        return this._current;
    }

    transition(target: TState): void {
        const allowed = this._transitions[this._current];
        if (!allowed || !allowed.includes(target)) {
            throw new Error(`Illegal transition: "${this._current}" \u2192 "${target}" for "${this._name}"`);
        }
        const from = this._current;
        this._current = target;
        for (const listener of this._listeners) {
            listener(from, target);
        }
    }

    canTransition(target: TState): boolean {
        const allowed = this._transitions[this._current];
        return !!allowed && allowed.includes(target);
    }

    assertState(...allowed: TState[]): void {
        if (!allowed.includes(this._current)) {
            const list = allowed.map((s) => `"${s}"`).join(", ");
            throw new Error(`"${this._name}" expected state ${list}, but current is "${this._current}"`);
        }
    }

    onTransition(cb: TransitionListener<TState>): () => void {
        this._listeners.add(cb);
        return () => {
            this._listeners.delete(cb);
        };
    }
}
