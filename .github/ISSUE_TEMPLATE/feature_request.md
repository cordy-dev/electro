---
name: Feature Request
about: Suggest a new feature or improvement
labels: enhancement
---

## Problem

A clear description of the problem or limitation you're facing.

Example: "When defining features with many services, there's no way to ..."

## Proposed Solution

Describe how you'd like this to work. Include API sketches if possible:

```ts
// Example of the API you'd expect
const myFeature = createFeature({
    id: "example",
    // proposed new option
    newOption: true,
});
```

## Alternatives Considered

What other approaches or workarounds have you thought about? Why wouldn't they work as well?

## Scope

Which package(s) does this affect?

- [ ] `@cordy/electro` (core runtime, features, services, tasks, events)
- [ ] `@cordy/electro-generator` (codegen, scanner)
- [ ] `@cordy/electro-cli` (dev server, build, preview)

## Additional Context

Any other information, mockups, or references that help explain the request.
