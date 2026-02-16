import type { ServiceScope } from "./enums";
import { Service } from "./service";
import type { CreatedService, ServiceConfig, ServiceId } from "./types";

/**
 * Creates a {@link Service} instance from a configuration object.
 *
 * @param config - Service configuration with `id`, `scope`, and `api`.
 * @returns A new `Service` instance ready for registration.
 * @throws If `config.id` is empty.
 */
export function createService<Scope extends ServiceScope, TApi, TId extends ServiceId = ServiceId>(
    config: ServiceConfig<Scope, TApi, TId>,
): CreatedService<Scope, TApi> {
    if (!config.id) {
        throw new Error("Service must have an id");
    }
    return new Service(config);
}
