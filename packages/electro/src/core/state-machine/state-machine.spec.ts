/**
 * Contract: StateMachine -- generic reusable FSM primitive.
 *
 * Sections:
 *   1. Construction & initial state
 *   2. Valid transitions
 *   3. Illegal transitions
 *   4. canTransition()
 *   5. assertState()
 *   6. onTransition() listeners
 */
import { describe, expect, it, vi } from "vitest";
import { StateMachine } from "./state-machine";

// -- Test FSM: a simple 3-state machine --
type TestState = "idle" | "running" | "stopped";

const TEST_TRANSITIONS: Record<TestState, TestState[]> = {
    idle: ["running"],
    running: ["stopped"],
    stopped: [],
};

function createTestMachine(name?: string) {
    return new StateMachine<TestState>({
        transitions: TEST_TRANSITIONS,
        initial: "idle",
        name,
    });
}

describe("StateMachine", () => {
    // -- 1. Construction & initial state --
    describe("Construction & initial state", () => {
        it("starts in the initial state", () => {
            const sm = createTestMachine();
            expect(sm.current).toBe("idle");
        });
    });

    // -- 2. Valid transitions --
    describe("Valid transitions", () => {
        it("idle -> running", () => {
            const sm = createTestMachine();
            sm.transition("running");
            expect(sm.current).toBe("running");
        });

        it("running -> stopped", () => {
            const sm = createTestMachine();
            sm.transition("running");
            sm.transition("stopped");
            expect(sm.current).toBe("stopped");
        });
    });

    // -- 3. Illegal transitions --
    describe("Illegal transitions", () => {
        it("idle -> stopped throws", () => {
            const sm = createTestMachine("test-fsm");
            expect(() => sm.transition("stopped")).toThrow(
                'Illegal transition: "idle" \u2192 "stopped" for "test-fsm"',
            );
        });

        it("stopped -> idle throws (terminal state)", () => {
            const sm = createTestMachine("test-fsm");
            sm.transition("running");
            sm.transition("stopped");
            expect(() => sm.transition("idle")).toThrow('Illegal transition: "stopped" \u2192 "idle" for "test-fsm"');
        });

        it("does not mutate state on illegal transition", () => {
            const sm = createTestMachine();
            try {
                sm.transition("stopped");
            } catch {
                // expected
            }
            expect(sm.current).toBe("idle");
        });

        it("uses default name when none provided", () => {
            const sm = createTestMachine();
            expect(() => sm.transition("stopped")).toThrow('for "StateMachine"');
        });
    });

    // -- 4. canTransition() --
    describe("canTransition()", () => {
        it("returns true for allowed transition", () => {
            const sm = createTestMachine();
            expect(sm.canTransition("running")).toBe(true);
        });

        it("returns false for disallowed transition", () => {
            const sm = createTestMachine();
            expect(sm.canTransition("stopped")).toBe(false);
        });

        it("returns false from terminal state", () => {
            const sm = createTestMachine();
            sm.transition("running");
            sm.transition("stopped");
            expect(sm.canTransition("idle")).toBe(false);
            expect(sm.canTransition("running")).toBe(false);
        });
    });

    // -- 5. assertState() --
    describe("assertState()", () => {
        it("does not throw when current state is in allowed list", () => {
            const sm = createTestMachine("test-fsm");
            expect(() => sm.assertState("idle")).not.toThrow();
            expect(() => sm.assertState("idle", "running")).not.toThrow();
        });

        it("throws when current state is not in allowed list", () => {
            const sm = createTestMachine("test-fsm");
            expect(() => sm.assertState("running", "stopped")).toThrow(
                '"test-fsm" expected state "running", "stopped", but current is "idle"',
            );
        });
    });

    // -- 6. onTransition() listeners --
    describe("onTransition() listeners", () => {
        it("calls listener on successful transition", () => {
            const sm = createTestMachine();
            const listener = vi.fn();
            sm.onTransition(listener);
            sm.transition("running");
            expect(listener).toHaveBeenCalledWith("idle", "running");
        });

        it("calls multiple listeners", () => {
            const sm = createTestMachine();
            const a = vi.fn();
            const b = vi.fn();
            sm.onTransition(a);
            sm.onTransition(b);
            sm.transition("running");
            expect(a).toHaveBeenCalledOnce();
            expect(b).toHaveBeenCalledOnce();
        });

        it("unsubscribe removes the listener", () => {
            const sm = createTestMachine();
            const listener = vi.fn();
            const unsub = sm.onTransition(listener);
            unsub();
            sm.transition("running");
            expect(listener).not.toHaveBeenCalled();
        });

        it("does not call listeners on failed transition", () => {
            const sm = createTestMachine();
            const listener = vi.fn();
            sm.onTransition(listener);
            try {
                sm.transition("stopped");
            } catch {
                // expected
            }
            expect(listener).not.toHaveBeenCalled();
        });
    });
});
