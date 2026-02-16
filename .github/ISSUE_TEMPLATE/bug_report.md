---
name: Bug Report
about: Report a bug in @cordy/electro
labels: bug
---

## Description

A clear description of the bug.

## Steps to Reproduce

1. Create a feature with `createFeature({ ... })`
2. Register it via `runtime.register([...])`
3. Call `runtime.start()`
4. Observe the error

## Expected Behavior

What you expected to happen instead.

## Actual Behavior

What actually happened. Include error messages, stack traces, or unexpected output.

## Minimal Reproduction

Link to a repo or paste a minimal code snippet that reproduces the issue:

```ts
import { createRuntime, createFeature } from "@cordy/electro";

const feature = createFeature({
    id: "repro",
    onActivate(ctx) {
        // ...
    },
});

const runtime = createRuntime();
runtime.register([feature]);
await runtime.start(); // <- error here
```

## Environment

- `@cordy/electro` version:
- `@cordy/electro-cli` version:
- Electron version:
- Bun version:
- Vite version:
- OS:

## Logs

<details>
<summary>Console output</summary>

```
Paste relevant logs here
```

</details>

## Additional Context

Any other information that might help (screenshots, related issues, etc).
