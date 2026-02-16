# @cordy/electro

A feature-first Electron framework for Bun + Vite 8+. Provides a managed runtime kernel, codegen for preload/bridge types, and configuration via `defineConfig`/`defineRuntime`/`defineWindow`.

## Packages

| Package                                                    | Description                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`@cordy/electro`](packages/electro)                      | Core framework — runtime kernel, feature system, services, tasks, events, and policy engine   |
| [`@cordy/electro-generator`](packages/electro-generator)  | Code generator — scans features and emits preload scripts and bridge types                    |
| [`@cordy/electro-cli`](packages/electro-cli)              | CLI — `electro dev`, `electro build`, `electro generate`, `electro preview`                   |

## Install

```bash
bun add @cordy/electro @cordy/electro-cli
bun add electron
```

Peer dependencies: `electron >=40.4.1`, `vite >=8.0.0`.

## Quick Start

### 1. Define a runtime

```ts
// src/runtime/runtime.config.ts
import { defineRuntime } from "@cordy/electro";

export default defineRuntime({
    entry: "./main.ts",
    vite: {},
});
```

### 2. Define a window

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
// src/runtime/main.ts
import { createRuntime } from "@cordy/electro";
import { app } from "electron";
import { appCoreFeature, settingsFeature } from "./features";

const runtime = createRuntime();

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("before-quit", () => runtime.shutdown());

app.whenReady().then(async () => {
    runtime.register([appCoreFeature, settingsFeature]);
    await runtime.start();
});
```

### 5. Run

```bash
bun x electro dev
```

## CLI

```bash
electro dev          # Start dev server with Electron + HMR
electro build        # Build for production
electro preview      # Build and preview in Electron
electro generate     # Generate preload scripts and bridge types
```

## Architecture

### Runtime Kernel

The `Runtime` class orchestrates the entire main process. State machine: `CREATED → STARTING → RUNNING → STOPPING → STOPPED` (with `FAILED` as a terminal state). Features register during `CREATED`, then bootstrap initializes all features in dependency order via topological sort.

### Feature System

Features are the primary unit of organization. Each feature can own **services**, **tasks**, and **events**. The `FeatureManager` resolves dependencies and runs a two-phase lifecycle: initialize all → activate all. Features marked `critical: true` cause fast failure on error.

```ts
import { createFeature, createService, createTask } from "@cordy/electro";

const myService = createService({
    id: "db",
    scope: "internal",
    api: (ctx) => new DatabaseClient(ctx.config),
});

const myFeature = createFeature({
    id: "data-layer",
    services: [myService],
    onInitialize: async (ctx) => { /* ... */ },
    onActivate: async (ctx) => { /* ... */ },
});
```

### Services

Services are scope-partitioned: **private** (feature-internal), **internal** (cross-feature), or **exposed** (renderer/bridge). Built lazily on demand via factory pattern.

### Tasks

Scheduled and managed units of work with cron scheduling, retry logic (fixed/exponential), timeouts, and overlap strategies (skip/queue/parallel). Supports `AbortSignal` cancellation.

### Events

Channel-based pub/sub with owner tracking. `EventAccessor` scopes events per feature — publishing emits as `"featureId:eventName"`, subscribing validates dependency access.

### Policy Engine

Deny-by-default access control for window–feature access. A window's renderer can only access exposed services of features listed in its `features: []` config. Enforced at both build time (codegen) and runtime (IPC gating).

### Code Generation

The generator uses `oxc-parser` to scan `createFeature()` and `createService()` calls, then emits:

- Preload scripts per window (with only the services that window is allowed to access)
- Bridge type definitions for type-safe `window.bridge` usage in renderers

## Development

```bash
bun install           # Install dependencies
bun run build         # Build all packages
bun run test          # Run all tests
bun run lint          # Lint with Biome
bun run fmt           # Format with Biome
```

## License

MIT
