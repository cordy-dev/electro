# Contributing

Thanks for your interest in contributing to `@cordy/electro`.

## Setup

```bash
git clone <repo-url>
cd electro
bun install
```

## Development Workflow

```bash
bun run build         # Build all packages
bun run test          # Run all tests
bun run lint          # Lint with Biome
bun run lint:fix      # Auto-fix lint + format
bun run fmt           # Format with Biome
```

Run a single spec:

```bash
bunx vitest run packages/electro/src/core/task/task.spec.ts
```

## Code Style

Enforced by [Biome](https://biomejs.dev/):

- 4-space indentation, 120-char line width
- Double quotes, always semicolons, trailing commas
- `import type` must use separated style: `import type { Foo } from "..."`
- No unused imports, no import cycles

## Testing

- Specs are colocated: `task.ts` → `task.spec.ts`
- One top-level `describe("ClassName")` per spec file
- Black-box only — test the public API, no private field access
- Update or add specs alongside implementation changes

## Commit Messages

Keep commits focused. Use a short summary line describing the change:

```
feat: add retry backoff cap to task scheduler
fix: prevent duplicate service registration
```

## Pull Requests

- Branch from `master`
- Keep PRs focused on a single change
- Ensure `bun run test` and `bun run lint` pass before submitting
- Describe the motivation and approach in the PR body
