import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.spec.ts"],
        environment: "node",
        ui: false,
        testTimeout: 30_000,
        hookTimeout: 30_000,
        coverage: {
            provider: "istanbul",
        },
    },
});
