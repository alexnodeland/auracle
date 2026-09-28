---
name: check
description: >
  Pick and run the right verification for what changed in Auracle, from a
  single node --check to the full make check, browser specs and site checks.
  Use before committing, or when asked to verify a change.
---

# Check a change

Run the smallest set of gates that proves the change, then `make check` before
committing anything that touches Rust. The full table of gates and what each
proves is `docs/architecture/testing.md`.

## 1. See what changed

```bash
git status --short
git diff --stat HEAD
```

## 2. Run the gates for those paths

| Changed | Run |
| --- | --- |
| `crates/<crate>/**` | `cargo test -p <crate> --profile test-fast`, then `make lint` |
| Rust used by the app (`auracle-wasm`, or anything it calls) | also `make wasm-check`, then `make wasm` before any browser test |
| φ: phrase, features, normalization, vetting | `make revalidate` on both sides of the change, and diff the tables; then `make perform-wirings` and commit the file |
| Search or refinement | `make search-check` (or `make climb` for a quick read) |
| Taste model or MCMC budget | `make fit-bench`, `make closed-loop` |
| `apps/web/*.js`, `style.css`, `index.html` | `make web-check`, then the browser specs for the behaviour (the `browser-test` skill) |
| `www/**` or public API docs | `make site && make site-check` |
| `www/video/films/<film>/**` | `node www/video/tools/validate.mjs <film>`, then a rehearsal (the `film` skill) |
| `www/video/tools/**` | syntax (`node --check`, `py_compile`, `bash -n`) and a rehearsal of one shot that uses the tool |

## 3. Before committing

- `make check` when Rust changed; `make web-check` is enough for JS-only.
- A user-visible change also needs its descriptions updated (`truth-pass`)
  and a `CHANGELOG.md` entry (`changelog`).

## Reporting

Say which gates ran and their results, with the failing output if any. Do not
report a gate as passed if it did not run (a stale `pkg/`, a queued browser
job that never started).
