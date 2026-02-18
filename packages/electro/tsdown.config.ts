import { defineConfig } from "tsdown";

export default defineConfig({
    entry: {
        index: "src/index.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "esnext",
    dts: true,
    outDir: "dist",
    shims: false,
    treeshake: true,
    inlineOnly: false,
});
