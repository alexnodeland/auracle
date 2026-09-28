# Auracle: context for coding agents

Auracle is a synthesizer that learns your taste. It breeds real modular patches
(a typed grammar over [quiver](https://github.com/alexnodeland/quiver) modules),
plays you two at a time, and fits a Bayesian model of what you prefer from your
picks, stars and edits. The engine is Rust, compiled to wasm; the instrument is
a vanilla-JS web app with no build step; the site (landing page, guide,
technical reference, API docs and films) lives in `www/`.

This file is the front door. It holds only what every task needs. Each area has
its own `AGENTS.md` with the rules for working there, and `docs/` holds the
deeper material. Read those when a task takes you into their area, not before.

## Map

| Path | What it is | Read next |
| --- | --- | --- |
| `crates/auracle-grammar` | The genome: typed PCFG terms, compiler to quiver, edit ops, rack description, presets | [`crates/AGENTS.md`](crates/AGENTS.md) |
| `crates/auracle-features` | Render every patch on one phrase, vet, normalize loudness, extract φ | same |
| `crates/auracle-taste` | The taste model: max-of-experts utility, MCMC posterior, standardizer | same |
| `crates/auracle-session` | The two-loop engine: pool, duels, refits, refinement, PERFORM, persistence | same |
| `crates/auracle-wasm` | `WasmEngine` for the worker, `LivePoly` for the AudioWorklet | same |
| `apps/web` | The instrument: `main.js`, `worker.js`, `farm.js`, `perform.js`, `live-audio.js`, `midi.js`, `booth.js` | [`apps/web/AGENTS.md`](apps/web/AGENTS.md) |
| `tests/web` | Playwright specs against the real app and the built wasm | [`tests/web/AGENTS.md`](tests/web/AGENTS.md) |
| `www` | The site: landing, guide (`www/docs`), reference (`www/reference`), theme, figures | [`www/AGENTS.md`](www/AGENTS.md) |
| `www/video` | The films: scripts, shots, stage, voice, score, mix, publish | [`www/video/AGENTS.md`](www/video/AGENTS.md) |
| `docs` | For contributors and agents: architecture, decisions (ADRs), proposals, plans, runbooks | [`docs/README.md`](docs/README.md) |

`CHANGELOG.md` is user-facing release notes. `CONTRIBUTING.md` is the human
contributor guide; this file does not repeat it.

## Rules that hold everywhere

1. **Descriptions stay true.** The guide, the reference, the landing page, the
   films, the in-app copy and `CHANGELOG.md` all describe the app. Change
   behaviour and you update what describes it in the same change. When a
   description and the app disagree, prefer fixing the app to weakening the
   words ([ADR-004](docs/decisions/004-descriptions-stay-true.md)). The
   `truth-pass` skill finds what describes a behaviour.
2. **φ is a measurement contract.** The audition phrase, the feature list and
   loudness normalization define what the model can hear. Changing any of them
   owes `make revalidate` on both sides of the change and a diff of the tables
   ([`crates/auracle-features/AGENTS.md`](crates/auracle-features/AGENTS.md)).
3. **Rust tests run optimized.** Use `--profile test-fast` (or `make test`).
   The grammar, features and session suites render audio sample by sample, and
   a debug build is about 20 times slower and overflows the stack in the
   grammar suite. A hook enforces this.
4. **Rebuild the wasm after Rust changes the app uses.** `apps/web/pkg` is
   generated and ignored by git: `make wasm`, then reload. A session-start hook
   warns when it is older than the Rust sources.
5. **Browser jobs take a ticket.** Run every browser job through
   `www/video/tools/one_browser.sh` (a first-come, first-served line):
   rehearsals and recordings get the machine to themselves, browser tests run
   two at a time. Run a suite on its own port with `AURACLE_TEST_PORT`
   ([ADR-010](docs/decisions/010-tests-share-the-browser-recordings-do-not.md)).
6. **Seeded means reproducible.** Every consumer of randomness in the engine
   draws from its own stream, so timing cannot change what a seed deals
   ([ADR-001](docs/decisions/001-one-random-stream-per-consumer.md)). Do not
   share a generator across consumers again.
7. **Generated files are not hand-edited.** `apps/web/pkg/`, `site/`,
   `www/docs/src/img/`, `www/landing/assets/film/` (written by
   `www/video/tools/publish.py`) and the `<!-- film:NAME -->` blocks it fills.
   A hook blocks edits to the first three.
8. **Commits explain why.** Loose conventional prefixes (`feat:`, `fix(web):`,
   `docs:` …), an imperative subject, a body that says what was wrong and why
   this is the fix. User-visible changes get a `CHANGELOG.md` entry under
   `[Unreleased]`, written for someone who has never seen the repo.

## Commands

| When | Run |
| --- | --- |
| Before any commit | `make check` (fmt, clippy `-D warnings`, `node --check`, wasm32 check, all tests) |
| After changing Rust the app calls | `make wasm` |
| Only JS changed | `make web-check` |
| One crate's tests | `cargo test -p auracle-<crate> --profile test-fast` |
| Browser tests | `cd tests/web && AURACLE_TEST_PORT=8690 ../../www/video/tools/one_browser.sh npx playwright test [spec]` |
| The instrument, locally | `make serve`, then <http://localhost:8642> |
| The site | `make site && make site-check` (needs `make site-tools` once) |
| A φ-touching change | `make revalidate` before and after, then diff |

The `check` skill picks the right subset for what changed.

## Where to go deeper

- How the engine works: [`docs/architecture/system.md`](docs/architecture/system.md)
- The web runtime (threads, lanes, the bench, PERFORM): [`docs/architecture/web-runtime.md`](docs/architecture/web-runtime.md)
- Which test proves what: [`docs/architecture/testing.md`](docs/architecture/testing.md)
- How the films are made: [`docs/architecture/films.md`](docs/architecture/films.md)
- Why things are the way they are: [`docs/decisions/`](docs/decisions/) and the
  published [design decisions](https://auracle.alexnodeland.com/reference/design/decisions.html)
- When something breaks: [`docs/runbooks/`](docs/runbooks/)
