# Contributing to Ricercar

Thanks for your interest in contributing! This document covers the workflow
and the quality bar. It follows the same conventions as
[quiver](https://github.com/alexnodeland/quiver) and the
[fugue ecosystem](https://github.com/alexnodeland/fugue).

## Code of Conduct

This project follows the
[Rust Code of Conduct](https://www.rust-lang.org/policies/code-of-conduct).
Be respectful and constructive.

## Getting Started

1. **Fork and clone** — note that Ricercar needs sibling checkouts of its
   path dependencies (`../quiver`, `../fugue-ecosystem/{fugue,fugue-evo}`);
   see the README's Quick Start for the exact layout.
2. **Install Rust** (stable) via [rustup](https://rustup.rs/), plus
   [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) if you're touching
   the web app.
3. **Verify your setup**:
   ```bash
   make check
   ```

## Development Workflow

- Branch from `main` with a descriptive name
  (`feature/tempo-synced-lfo`, `fix/arp-gate-length`, `docs/…`).
- Run `make check` locally before pushing — it is exactly what CI enforces
  (rustfmt, clippy with `-D warnings`, the release-mode test suite).
- If you changed Rust that the web app uses, rebuild with `make wasm` and
  smoke-test the instrument (`make serve`, play a patch, watch the console).

## Pull Request Process

1. Keep PRs focused; separate refactors from behavior changes.
2. Update docs alongside code: `DESIGN.md` for design decisions,
   `DEVELOPMENT.md` for workflow/sharp edges, `CHANGELOG.md` under
   `[Unreleased]` for anything user-visible.
3. Add or extend a **gate test** for new behavior (see
   [`DEVELOPMENT.md`](../DEVELOPMENT.md#quality-bar)) — property-style tests
   over random trees / synthetic users are preferred over mocks.
4. CI must be green.

## Commit Messages

Conventional-commit style prefixes are used loosely
(`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`) with an imperative
subject line and a body that explains *why*.

## Testing Guidelines

- `make test` runs the whole workspace in release mode (the DSP tests render
  real audio and are ~20× slower in debug).
- Audio-thread code (`LivePoly`) must stay allocation-free per quantum and
  wall-clock-free; there are chaos tests that will catch panics, but review
  for these properties explicitly.
- UI changes should be exercised in a real browser with the console open;
  `window.__ric` exposes the live engine for scripted checks.
