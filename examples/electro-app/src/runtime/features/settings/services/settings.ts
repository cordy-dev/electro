import { createService, ServiceScope } from "@cordy/electro";

export const settingsPublicService = createService({
    id: "settings",
    scope: ServiceScope.EXPOSED,
    api: (_ctx) => {
        // In a real app, this would delegate to the store via ctx
        const data = new Map<string, unknown>();
        return {
            get: (key: string) => data.get(key),
            set: (key: string, value: string) => data.set(key, value),
        };
    },
});
