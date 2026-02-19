import { Window } from "./window";
import type { CreatedWindow, WindowConfig, WindowId } from "./types";

/**
 * Creates a {@link Window} instance from a configuration object.
 *
 * @param config - Window configuration with `id`, optional `options`, and optional `api`.
 * @returns A new `Window` instance ready for registration.
 * @throws If `config.id` is empty.
 */
export function createWindow<TApi = void>(
    config: WindowConfig<TApi>,
): CreatedWindow<TApi> {
    if (!config.id) {
        throw new Error("Window must have an id");
    }
    return new Window(config);
}
