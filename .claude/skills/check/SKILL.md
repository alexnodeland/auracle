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

CI is the gate for everything else: the full browser tier runs there, dealt to
eight runners by time, and a PR that changes only specs runs only those specs.
Locally, run what your change reaches, never the full browser suite
(`docs/process.md` § Building).

## 1. See what changed

```bash
git status --short
git diff --stat HEAD
```

## 2. Run the gates for those paths

| Changed | Run |
| --- | --- |
| `crates/<crate>/**` | `cargo test -p <crate> --profile test-fast --lib --bins --tests` (the flags skip building the examples, which no test runs), then `make lint` |
| Rust used by the app (`auracle-wasm`, or anything it calls) | also `make wasm-check`, then `make wasm` before any browser test |
| φ: phrase, features, normalization, vetting | `make revalidate` on both sides of the change, and diff the tables; then `make perform-wirings` and commit the file |
| Search or refinement | `make search-check` (or `make climb` for a quick read) |
| Taste model or MCMC budget | `make fit-bench`, `make closed-loop` |
| `apps/web/*.js`, `style.css`, `index.html` | `make web-check` (the pure modules' unit tests), then the browser specs the change reaches: `make browser-changed`, or by name for `main.js` (the `browser-test` skill) |
| `tests/web/**` | the specs you changed, through the queue; `--repeat-each=3` for one you made less flaky |
| `.github/workflows/**`, `.github/actions/**` | `actionlint` if installed (`brew install actionlint`); the PR's own CI run is the test (a workflow change runs everything) |
| `www/**` or public API docs | `make site && make site-check` |
| `www/video/films/<film>/**` | `node www/video/tools/validate.mjs <film>`, then a rehearsal (the `film` skill) |
| `www/video/tools/**` | syntax (`node --check`, `py_compile`, `bash -n`) and a rehearsal of one shot that uses the tool |
| Any copy: app strings, the site, the guide, the reference, a film's lines or on-screen text, the README, the changelog | `python3 www/checkwords.py` (or `make dev-check`); `make web-check` does not run it. A sweep that lowers a count runs `python3 www/checkwords.py --update` in the same change |

## 3. Before committing

- `make check` when Rust changed; `make web-check` is enough for JS-only,
  unless a string changed: then `make dev-check` too, for the voice check.
- A user-visible change also needs its descriptions updated (`truth-pass`)
  and a `CHANGELOG.md` entry (`changelog`).
- `apps/web/style.css` or `main.js` changed: nothing to bump. The site and
  the bundle stamp them with their content hashes (`www/stamppage.py`).

## Reporting

Say which gates ran and their results, with the failing output if any. Do not
report a gate as passed if it did not run (a stale `pkg/`, a queued browser
job that never started).
