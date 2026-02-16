import { createService, ServiceScope } from "@cordy/electro";

export const storeService = createService({
    id: "store",
    scope: ServiceScope.PRIVATE,
    api: () => {
        const data = new Map<string, any>();

        return {
            get(key: string) {
                return data.get(key)?.value;
            },
            set(key: string, value: any) {
                data.set(key, { key, value, updatedAt: Date.now() });
            },
            all() {
                return [...data.values()];
            },
        };
    },
});
