import { View } from "./view";
import type { CreatedView, ViewConfig } from "./types";

/**
 * Creates a {@link View} instance from a configuration object.
 *
 * @param config - View configuration with `id`, and either `renderer` (for Vite-built views) or `webPreferences` (for dynamic views).
 * @returns A new `View` instance ready for registration.
 * @throws If `config.id` is empty.
 */
export function createView(config: ViewConfig): CreatedView {
    if (!config.id) {
        throw new Error("View must have an id");
    }
    return new View(config);
}
