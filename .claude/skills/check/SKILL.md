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

CI is the gate for everything else, in two lanes. A PR's own run, the fast
lane, runs what the change reaches: the Rust jobs when Rust changed, the site,
the browser specs `make browser-changed` would pick (up to four runners), and
the smoke pair when the app, the engine or what runs the specs changed. The
merge queue's run is the full gate: everything, the browser tier dealt to
twelve runners by time. The slow tier runs on a PR only with the `full-ci`
label.
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
| `crates/<crate>/**` | `make test-crate CRATE=<crate>` (optimized, on the pinned compiler, without building the examples no test runs), then `make lint`; before review, `make coverage`: every crate at its floor and every changed line covered by a test that asserts what it does (`crates/AGENTS.md` § Coverage); and `make mutants DIFF=1` (on a shared machine, `nice -n 19`): every mutant of the changed code caught, each survivor killed or answered (`crates/AGENTS.md` § Mutation testing) |
| Rust used by the app (`auracle-wasm`, or anything it calls) | also `make wasm-check`, then `make wasm` before any browser test (`make wasm-dev` builds in seconds for trying it by hand in `make serve`; the specs and films refuse it) |
| φ: phrase, features, normalization, vetting | `make revalidate` on both sides of the change, and diff the tables; then `make perform-wirings` and commit the file |
| Search or refinement | `make search-check` (or `make climb` for a quick read) |
| Taste model or MCMC budget | `make fit-bench`, `make closed-loop` |
| `apps/web/*.js`, `style.css`, `index.html` | `make web-check` (the pure modules' unit tests), then the browser specs the change reaches: `make browser-changed`, or by name for `main.js` (the `browser-test` skill) |
| `apps/web/worker.js`, `farm.js`, `tests/worker/**` | also `make worker-test` (the worker in Node over `pkg/`, no page; `make wasm` first) |
| `tests/web/**` | `make spec-lint` (the after-edit hook lints each file as you edit it; a fixed violation is recorded with `npx eslint --prune-suppressions` in `tests/web`, `tests/web/AGENTS.md` § The lint), then the specs you changed, through the queue; `--repeat-each=3` for one you made less flaky |
| `.github/workflows/**`, `.github/actions/**` | `actionlint` if installed (`brew install actionlint`); the PR's own CI run is the test (a workflow change runs everything) |
| `www/**` or public API docs | `make site && make site-check` |
| `www/video/films/<film>/**` | `node www/video/tools/validate.mjs <film>`, then a rehearsal (the `film` skill) |
| `www/video/tools/**` | syntax (`node --check`, `py_compile`, `bash -n`) and a rehearsal of one shot that uses the tool |
| A changelog entry (`changelog.d/*.md`) or `scripts/changelog.py` | `python3 scripts/changelog.py --check`, and `python3 scripts/test_changelog.py` for the script (both in `make dev-check`) |
| `scripts/pr_checks.py`, `.github/PULL_REQUEST_TEMPLATE.md` | `python3 scripts/test_pr_checks.py` (in `make dev-check`; it reads the template too), and `python3 scripts/pr_checks.py check --pr <n>` on a real PR (`merged --pr <n> --dry-run` for the merge job); before a PR is opened, `PR_TITLE="…" PR_BODY="$(cat <body file>)" python3 scripts/pr_checks.py title` (and `links`) |
| Any copy: app strings, the site, the guide, the reference, a film's lines or on-screen text, the README, the changelog and its entries in `changelog.d/` | `python3 www/checkwords.py` (or `make dev-check`); `make web-check` does not run it. A sweep that lowers a count runs `python3 www/checkwords.py --update` in the same change |

## 3. Before committing

- `make check` when Rust changed; `make web-check` is enough for JS-only,
  unless a string changed: then `make dev-check` too, for the voice check.
  `make web-check` (and so `make check`) includes the spec lint, which needs
  `npm ci` in `tests/web` once (it says so when that is missing).
- A user-visible change also needs its descriptions updated (`truth-pass`)
  and a changelog entry as `changelog.d/<topic>.md` (`changelog`).
- `apps/web/style.css` or `main.js` changed: nothing to bump. The site and
  the bundle stamp them with their content hashes (`www/stamppage.py`).

## Reporting

Say which gates ran and their results, with the failing output if any. Do not
report a gate as passed if it did not run (a stale `pkg/`, a queued browser
job that never started).
