## What

<!-- What does this PR change, from a user's / player's perspective? -->

## Why

<!-- Motivation and context. Link issues if applicable. -->

## How

<!-- Notable implementation decisions, trade-offs, anything reviewers should
     look at closely. -->

## Checklist

- [ ] `make check` passes (fmt, clippy `-D warnings`, release tests)
- [ ] New behavior is covered by a test (gate/property style preferred)
- [ ] Docs updated where relevant (`DESIGN.md` / `DEVELOPMENT.md` / `CHANGELOG.md`)
- [ ] If Rust used by the web app changed: rebuilt with `make wasm` and
      smoke-tested the instrument in a browser (no console errors)
