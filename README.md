# @cordy/electro

`@cordy/electro` is a window-first Electron framework for Bun + Vite 8+.

It gives you:

- root app config via `electro.config.*` + `defineConfig(...)`
- autonomous window packages via `defineWindow(...)`
- managed preload generation (no manual preload boilerplate)
- generated `window.bridge` typings per window
- feature-first runtime APIs for main-process orchestration

## Install

```bash
bun add -d @cordy/electro
bun add -d vite@^8
bun add electron
```

## Quick Start

### 1. Define a runtime package

```ts
// src/windows/main/runtime.config.ts
import { defineRuntime } from "@cordy/electro";

export default defineRuntime({
    entry: "./src/core/index.ts",
    vite: {},
});

```

### 2. Define a window package

```ts
// src/windows/main/window.config.ts
import { defineWindow } from "@cordy/electro";

export default defineWindow({
    name: "main",
    entry: "./index.html",
    features: ["app-core", "settings", "sync"],
    vite: {},
});

```

### 3. Define root app config

```ts
// electro.config.ts
import { defineConfig } from "@cordy/electro";
import runtimeConfig from "./src/runtime/runtime.config";
import mainWindow from "./src/windows/main/window.config";

export default defineConfig({
    runtime: runtimeConfig,
    windows: [mainWindow],
});

```

### 4. Initialize the runtime

```ts
// src/core/index.ts
import { createRuntime } from "@cordy/electro";
import { appCoreFeature, settingsFeature } from "./features";


const runtime = createRuntime({
    features: [appCoreFeature, settingsFeature],
});

await runtime.start();
```

### 5. Run

```bash
bun x electro dev
```
