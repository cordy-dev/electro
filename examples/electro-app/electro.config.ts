import { defineConfig } from "@cordy/electro";
import runtimeConfig from "./src/runtime/runtime.config";
import mainWindow from "./src/windows/main/window.config";

export default defineConfig({
    runtime: runtimeConfig,
    windows: [mainWindow],
});
