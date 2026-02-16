import { Runtime } from "./runtime";
import type { RuntimeConfig } from "./types";

export function createRuntime(config?: RuntimeConfig): Runtime {
    return new Runtime(config);
}
