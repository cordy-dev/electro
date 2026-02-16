import { createService, ServiceScope } from "@cordy/electro";

export const defaultsService = createService({
    id: "defaults",
    scope: ServiceScope.INTERNAL,
    api: () => ({
        getDefaults: () => ({
            theme: "system",
            language: "en",
            autoUpdate: true,
            fontSize: 14,
        }),
    }),
});
