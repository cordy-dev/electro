/**
 * Main process entry point.
 *
 * Creates an Electro runtime with features, wires up Electron lifecycle,
 * and demonstrates the full feature/service/task/event system.
 */

import { createRuntime } from "@cordy/electro";
import { app } from "electron";
import { analyticsFeature, appCoreFeature, settingsFeature, syncFeature, windowControlsFeature } from "./features";

const runtime = createRuntime();

// == Handle Electron Events ===========================
if (!app.requestSingleInstanceLock()) {
    app.quit();
}

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("before-quit", () => runtime.shutdown());

app.whenReady().then(async () => {
    app.setAppUserModelId('com.watchwithme.app');

    // == Register Features ================================
    runtime.register([appCoreFeature, analyticsFeature, settingsFeature, syncFeature, windowControlsFeature]);

    // == Start Runtime ====================================
    await runtime.start();
});
