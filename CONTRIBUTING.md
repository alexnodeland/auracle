# Contributing to Auracle

This document is for people working **on** Auracle rather than playing it: the
layout, the workflow, the quality bar, the sharp edges, and how a release is
cut. It follows the same conventions as
[quiver](https://github.com/alexnodeland/quiver) and the
[fugue ecosystem](https://github.com/alexnodeland/fugue).

The engineering record (architecture notes, decisions, proposals, runbooks)
is in [`docs/`](./docs/README.md), and each area's working rules are in its
`AGENTS.md`, starting from the [root one](./AGENTS.md); coding agents read
the same files.

For the web app's internals see [`apps/web/README.md`](./apps/web/README.md);
for the documentation site see [`www/README.md`](./www/README.md); for how the
instrument works see the [technical
reference](https://auracle.alexnodeland.com/reference/), which holds the
model, the search, and the [design
decisions](https://auracle.alexnodeland.com/reference/design/decisions.html).

## Code of Conduct

This project follows the
[Rust Code of Conduct](https://www.rust-lang.org/policies/code-of-conduct).
Be respectful and constructive.

## Getting started

1. **Fork and clone.** The in-house foundations (`quiver-dsp`, `fugue-ppl`,
   `fugue-evo`) come from **crates.io**, so a single clone builds. To hack on
   them alongside Auracle, put sibling checkouts at `../quiver` and
   `../fugue-ecosystem/{fugue,fugue-evo}` and uncomment the `[patch.crates-io]`
   block at the bottom of the workspace `Cargo.toml` — don't commit the
   uncommented patch.
2. **Install [rustup](https://rustup.rs/) and Node 22** (the version in
   `.node-version`; fnm or nvm pick it up), then run **`make setup`**
   (`scripts/setup.sh`): it installs the Rust release `rust-toolchain.toml`
   pins (with rustfmt, clippy and the wasm32 target, and its `llvm-tools`),
   `wasm-pack`, `cargo-nextest` and `cargo-llvm-cov`, installs the browser
   tests' packages and Chromium, turns on the git hooks and builds the app's
   engine. It is idempotent; run it again
   after pulling. For the films, **`make film-setup`** also builds
   `.venv-voice` (the narration's pinned Kokoro/Whisper set and the film
   tools' packages; needs Python 3.10–3.12), downloads the voice models and
   renders the shared sound. `scripts/setup.sh --site` adds the site's
   mdBook toolchain.
3. **Verify your setup** with `make check`.
4. The git hooks `make setup` turns on check the formatting and syntax of
   what you stage, in seconds (skip once with `git commit --no-verify`).
   `.editorconfig` sets each file type's indentation for your editor.

## Layout

```
crates/
  auracle-grammar/    the genome: typed PCFG terms, trace codec, compiler,
                       structural edit ops, describe (rack view), presets
  auracle-features/   phrase render → vet → LUFS-normalize → φ features
  auracle-taste/      max-of-experts taste model + MCMC posterior
  auracle-session/    two-loop engine, acquisition, persistence
  auracle-wasm/       WasmEngine (worker) + LivePoly (AudioWorklet)
apps/web/              the instrument (vanilla JS, no build step)
www/                   the site: landing page + two mdBooks + the shared theme
```

## Workflow

How a change moves from an issue to `main` (issues and labels, review before
the PR, CI as the gate, merging, flaky tests, approvals for new words) is
[`docs/process.md`](docs/process.md). This section is the commands.

Branch from `main` with a descriptive name (`feature/tempo-synced-lfo`,
`fix/arp-gate-length`, `docs/…`). To work on more than one change at a time,
give each branch a worktree of its own inside the checkout, at
`.claude/worktrees/<topic>`, which git ignores:
`make worktree TOPIC=tempo-lfo BRANCH=feature/tempo-synced-lfo` makes it from
`origin/main` and installs `tests/web`'s packages there, and
`make worktree-rm TOPIC=tempo-lfo BRANCH=feature/tempo-synced-lfo` removes it
and the branch once it is merged. Keep the main checkout itself on `main`.
Then:

```bash
make check          # fmt + clippy -D warnings + node --check + the specs' lint + dev-check + wasm32 check + tests (CI gate)
make help           # every make target, with what it does
make wasm           # rebuild apps/web/pkg after any Rust change
make serve          # http://localhost:8642 — just the instrument
make smoke          # boot the instrument in a browser against pkg/ (make smoke-tools once)
make worker-test    # the engine worker in Node against pkg/, no page: its replies and lanes
make coverage       # the Rust's coverage from the fast tier: each crate's floor, every changed line
make mutants DIFF=1 # mutation testing of the Rust you changed: would a test notice it broken?
```

The site is a second, independent gate:

```bash
make site-tools     # install the pinned doc toolchain (once)
make site           # build all four sections into site/
make site-serve     # http://localhost:8643 — the whole site, as published
make site-check     # every link, asset and anchor must resolve
make docs-serve     # live-reloading authoring loop for the guide
make reference-serve
```

CI runs `make site` and `make site-check` on every PR, because the site's
failure modes are invisible to `make check`: an undefined KaTeX macro is a
build *warning*, a cross-section link only exists once four sections are
assembled, and a root-absolute path works at a domain root and 404s under a
project subpath or from a `file://` copy.

- **Tests run in release mode.** The grammar/features/session suites render
  real audio sample-by-sample; debug DSP is ~20× slower.
- **One Rust compiler, rustup's.** `rust-toolchain.toml` pins the release
  CI builds with, and rustup's proxies read it; a Homebrew cargo or rustc
  does not (and lacks the wasm32 std). Every `make` target puts
  `~/.cargo/bin` first on its PATH, and both formatting hooks run rustup's
  rustfmt. A bare `cargo` in a shell with Homebrew first on PATH runs
  Homebrew's: go through `make`, or put `~/.cargo/bin` first. A new Rust
  release arrives in a PR of its own that changes the file.
- **The dev server sends `Cache-Control: no-store`** and the app version-stamps
  its worker/wasm URLs. Both are needed; the browser's heuristic cache ignores
  late `no-store` on already-cached module workers.
- **The instrument lives at `/play/` on the published site**, not at the root;
  the root is the landing page. Nothing in the app assumes its own path (every
  asset reference is relative), and `make site-check` is what keeps it that
  way.

## Quality bar

Every change must pass `make check`:

1. `cargo fmt --all --check`
2. `cargo clippy --workspace --all-targets -- -D warnings`
3. `node --check` on every `apps/web` script, the pure modules' unit tests,
   and ESLint over the browser specs (`make web-check`; the lint needs
   `npm ci` in `tests/web`, which `make setup` runs)
4. The tooling's own checks (`make dev-check`): the agent docs' links and
   frontmatter, every constant the books quote by name still existing in the
   code (`www/checknames.py`), the color tokens (`www/brand/tokens.py`), the
   voice (`www/checkwords.py`: no file's count of banned words, em dashes or
   British spellings above `www/brand/voice-baseline.json`), the Claude Code
   hooks against the inputs they must block and pass, and the syntax of every
   film tool
5. `cargo check -p auracle-wasm --target wasm32-unknown-unknown --release`
   (`make wasm-check`; the pinned toolchain brings the target)
6. `cargo test --workspace --profile test-fast --lib --bins --tests`, then
   the doctests (`--doc`) — release-grade codegen without release's shipping
   flags (see the profile's comment in `Cargo.toml`), and no build of the
   examples, which no test runs and step 2 already compiles

That list is what CI's Lint, Web and Doctests jobs, its Rust tests (run
instrumented, as Coverage) and its wasm32 build (the engine job, with
warnings as errors) run, so "green locally" and "green in CI" are one
claim. What CI runs that `make check` does
not is the site build (`make site && make site-check`) with the browser smoke
test after it (`make smoke`'s two specs), the worker-protocol tests
(`make worker-test`), and the browser specs, because they need the wasm built
and the site needs the pinned doc toolchain.

CI runs in two tiers
([`docs/architecture/testing.md` § CI tiers](docs/architecture/testing.md#ci-tiers)).
The **fast tier** is the required `CI` check: the jobs above, the Rust tests
except the slow ones (instrumented, for coverage), and every browser spec not
tagged `@slow` or `@quarantine`, dealt to twelve runners by time, about
twelve minutes. It runs in two lanes. Your PR's own run is the fast lane,
the part of it your change reaches: about five minutes for docs, up to about
ten when Rust changed or an app module's specs run; green, with `PR checks`
([Pull requests](#pull-requests)), it puts the PR in the merge queue. The
merge queue's run is the full gate, on your PR together with up to two
others queued beside it, on top of `main`, and it is what merges them. A PR
may merge on the fast tier and `PR checks` alone. The **slow tier**
(the *Slow suite* workflow) runs the search floor, the other Rust tests over
a minute and the `@slow` and `@quarantine` browser specs
on `main` (the newest push, whose run covers the ones before it) and
nightly, where a failure opens an issue (a quarantined test's is a comment
on its own issue instead, while that issue is open); on a PR
only when you add the `full-ci` label. Add it when the PR changes what those
tests cover: any crate, `Cargo.toml` or `Cargo.lock`, `rust-toolchain.toml`,
the `Makefile`, `slow-suite.yml` or `.github/actions/`; `apps/web/`'s
`worker.js`, `farm.js`, `perform.js`, `patch.js`, `live-audio.js`,
`audio-in.js`, `explain.js`, `faces.js` or `vessel.js`; `tests/web/`'s
`fixtures.js`, `playwright.config.js`, `package.json` or `package-lock.json`;
a spec file that holds an `@slow` or `@quarantine` test; or a `main.js`
change that reaches EVOLVE's generations or PERFORM's offers. A flaky test is fixed or quarantined, never retried
([§ Flakes](docs/architecture/testing.md#flakes)). Locally, `make check` still runs every
Rust test; `make test-fast-tier` / `make test-slow-tier` and
`make browser-fast` / `make browser-slow` run one tier the way CI does.

Coverage holds a Rust change to two things: no crate's line or function
coverage falls below its floor in `crates/coverage-baseline.json`, and every
line the change adds or changes in `crates/` is run by a fast-tier test that
checks what it does. `make coverage` runs the same locally, with the HTML
report in `target/llvm-cov/html/`
([`crates/AGENTS.md` § Coverage](crates/AGENTS.md#coverage)).

Coverage says a test ran a line, not that it checked it. `make mutants
DIFF=1` changes the code you changed one small way at a time (a `<` made
`<=`, a function returning a default) and runs its crate's fast tier on
each change; a change no test fails on survives, and review treats a
survivor as a finding. The *Mutants* workflow runs the same on your PR's
own run (done at once when no Rust changed), and weekly on a part of the
workspace, a fifteen-week cycle aiming to cover it all. It is a workflow
of its own, in neither the fast lane nor the full gate, and nothing waits
on it to merge
([`crates/AGENTS.md` § Mutation testing](crates/AGENTS.md#mutation-testing)).

Changes that touch `www/`, `apps/web/` or any public API must also pass `make
site && make site-check`. If you changed a doc comment that the reference
quotes a number from, the number in the reference is now wrong. The books cite
constants by name so they can be grepped.

Beyond that, the codebase leans on **gate tests** rather than mocks: the
closed-loop test fits a real posterior against a synthetic user; the
structural-edit gate applies every op at every node of random trees and
requires the result to stay compilable; the live-audio tests assert numeric
properties of rendered samples (fade boundaries, smoother convergence, chaos
survival). Prefer extending a gate over asserting implementation details.

Audio-thread code (`LivePoly`) must stay allocation-free per quantum and
wall-clock-free; there are chaos tests that will catch panics, but review for
these properties explicitly.

## Sharp edges

- **AudioWorklets have no `fetch`/`TextDecoder`/`TextEncoder`.** The worklet is
  assembled as a blob with the wasm-bindgen glue inlined behind a polyfill, and
  raw wasm **bytes** are transferred (a transferred `WebAssembly.Module` dies
  as a silent `messageerror` in some engines).
- **No wall clock on the audio thread**: `LivePoly` uses a deterministic
  xorshift for the random arp; `Date.now()`-anything belongs on the main
  thread.
- **The trace address scheme is the spine.** Panel knobs, hand edits, locks,
  live parameter handles, and MH proposals all share the genome's address
  scheme (`node/0#cut`, `amp#attack`, `node/0/m#rate`). The canonical
  `TraceGenome` codec **is** the grammar's addressing, and a round-trip
  property test keeps them from drifting.
- **No backticks anywhere inside `PROCESSOR`** in `apps/web/live-audio.js` —
  the whole worklet class is a template literal, so one in a *comment* ends the
  string and the file stops parsing. `node --check apps/web/live-audio.js`
  catches it and nothing else does: the failure mode is a blob that never
  registers, not an error at the edit site.
- **Persisted UI state must be JS-owned**, never scraped from the DOM at save
  time (a phantom DOM slider reset once poisoned an autosave).
- **Worker replies are load-bearing**: every workbench edit message must get a
  reply (`bench` or `edit_rejected`) or the main thread's in-flight queue
  deadlocks.
- **Keep wasm-boundary ids `u32`.** wasm-bindgen maps `u64` to `BigInt`, which
  every arithmetic site on the JS side then has to know about.
- **A knob drag must not re-render the rack SVG mid-drag** — replacing the
  element kills pointer capture. The `knobDragging` flag suppresses
  `renderRack()` until pointerup.
- **quiver's `Strict` validation rejects warning-class pairs** the compiler
  deliberately uses (constant bipolar Offset → unipolar knob); patches are
  wired in `Warn` mode with an allowlist test pinning the warning classes.
- **Evolving with everything locked usually finds no accepted move.**
  Structural proposals shift locked addresses and are rejected. The UI says so
  ("loosen some locks"). Expected, not a bug.
- **The closed-loop test scores the *best* lens.** With K lenses and a unimodal
  synthetic user, lens 0 is not the one that learned the user; asserting on it
  fails for the wrong reason.

## Verification beyond `make check`

Two browser specs are automated under `make smoke` (CI's *Browser smoke* job
runs them after the site build, against the engine the site ships, on a PR
that changes the app, the engine or what runs the specs; the merge queue's
browser tier runs them with every other spec), in Playwright's Chromium.
`tests/web/smoke.spec.js` boots the instrument and requires **no console
errors, a registered worklet, and an engine that reaches `playable`** — the
whole of its claim, and the only gate that notices a backtick in the worklet
literal, a wasm method the JS calls that the binary no longer exports, or a
protocol field renamed on one side. `tests/web/failure_flows.spec.js` provokes
the four failure flows the September 2026 audit fixed — an unparseable save
seeded into IndexedDB, an engine error, a vote the engine refused, a profile
import over an existing log — and requires each to be reported and contained.
Where it cannot provoke a step for real (the shipped binary has no reachable
trap) it dispatches the worker's message on the real `Worker` object and its
test name says so. It reaches the engine worker by wrapping `Worker` before
`main.js` runs; nothing in `apps/web` exists for the tests' sake.

The rest of `tests/web` (the bank, EVOLVE's feedback and generations, PATCH
editing, PERFORM's controls and offers, responsiveness, booth mode, the film
chip) runs in CI's two tiers and locally with `make browser-fast` and
`make browser-slow`; `tests/web/AGENTS.md` says how, and
[`docs/architecture/testing.md`](./docs/architecture/testing.md) lists what
each spec pins. Run them on their own port (`AURACLE_TEST_PORT`) through
`www/video/tools/one_browser.sh` when anything else might be using a browser.

What no spec covers about a UI change is still verified live in a browser,
with **numeric audio assertions** (an `AnalyserNode` RMS, boundary-sample
checks around patch swaps) plus a zero-console-error requirement. Debug hooks
for this live at `window.__aur` / `window.__aurLog` (`window.__ric` is kept as
an alias for notes written before the rename).

## Pull requests

1. Keep PRs focused; separate refactors from behavior changes.
2. Run `make check` locally before you push your branch and open the PR: it
   is CI's Lint, Web and Rust jobs. CI also runs the site and the browser
   specs: on your PR only the specs it reaches, and in the merge queue all of
   them, twelve runners wide. Locally, run the specs your change reaches
   (`make browser-changed`). If you
   changed Rust that the web app uses, rebuild with `make wasm` and
   smoke-test the instrument (`make serve`, play a patch, watch the console).
3. Update docs alongside code: `www/reference/` for design decisions and how it
   works, `www/docs/` for what the instrument *does*, and for anything
   user-visible, a changelog entry as `changelog.d/<topic>.md`, `<topic>`
   being your branch's ([`changelog.d/README.md`](changelog.d/README.md)
   says how). It holds what you would have put under `CHANGELOG.md`'s
   `[Unreleased]`, in a file of its own, so two open PRs never edit the same
   lines. A release moves it into `CHANGELOG.md`, and it becomes the release
   notes verbatim (see [Cutting a release](#cutting-a-release)), so write it
   for someone who has never seen the repo.
   - The reference quotes constants by name so they can be grepped when one
     moves. If you change a default, grep the books for it.
   - `make site && make site-check` before pushing a docs change. CI runs both.
4. Add or extend a **gate test** for new behavior. Property-style tests over
   random trees / synthetic users are preferred over mocks.
5. CI must be green: `main` requires it, and nobody can merge past it. So
   must `PR checks`, before the merge queue takes the PR:
   - **The title** is the squash commit's subject on `main`, so it starts
     with a type, as a commit message does: `fix(web): a toast is never
     dropped`, `tests: …`, `docs: …` ([Commit messages](#commit-messages)).
   - **The body** names its issues, one per line: `Closes #N` for each issue
     it finishes, with one keyword per issue (GitHub reads one issue per
     keyword, so `Closes #1, #2` closes #1 only), and `Refs #N` for each it
     advances. A small fix seen in passing may stand alone, and says why on
     a line that starts `No issue:`.
   - A change to `apps/web/`, `www/docs/src/` or `www/landing/` with no
     entry in `changelog.d/` gets a warning there (item 3), not a failure.

   Once the PR merges, the same workflow comments on each `Refs` issue,
   closes any `Closes` issue GitHub didn't, tells each closed issue's
   parent issue how many of its sub-issues are closed, and ticks the boxes
   in other open issues' checklists that name an issue that closed, once
   every issue each box names is closed as completed.
6. PRs merge through a merge queue
   ([Mergify](https://docs.mergify.com/merge-queue/), set up in
   `.mergify.yml`). Once your PR is reviewed, the maintainer adds the `queue`
   label and queues it. When its CI and `PR checks` are green it enters the
   queue, which runs the full gate
   on it together with up to two other queued PRs, on top of `main`, and
   squash-merges each as `<title> (#<number>)`, with the PR's commit messages
   as the commit's body (the repository's squash setting), so write each
   commit message to say why. A PR green on its own run can be red there: the queue
   then finds the PR at fault and takes it out, with a comment saying why; a
   fix and `@mergifyio queue` put it back.

### Commit messages

Conventional-commit style prefixes are used loosely (`feat:`, `fix:`, `docs:`,
`refactor:`, `chore:`) with an imperative subject line and a body that explains
*why*. A PR's title takes a prefix too, since it becomes its squash commit's
subject: one of `feat`, `fix`, `docs`, `tests`, `test`, `ci`, `build`,
`refactor`, `perf`, `chore`, `revert`, `style` or `release`, then an optional
`(scope)` and `: `. `PR checks` fails a title without one. A topic that isn't
a type is a scope: `feat(tokens): …`. A PR made with GitHub's Revert button is
titled `Revert "<title>"`: retitle it `revert: <title>`, and give its body a
`Refs #N` or a `No issue:` line, since the `Reverts …#N` it writes names a
PR.

## Cutting a release

A release is **one gesture: push a `vX.Y.Z` tag on the release PR's merge
commit.** One workflow watches that tag and nothing else has to be done by
hand:

- [`release.yml`](.github/workflows/release.yml) builds the wasm through the
  Makefile, zips a runnable web bundle as `auracle-vX.Y.Z-web.zip`, and creates
  the GitHub Release with the changelog section as its notes.

CI's deploy job ([`ci.yml`](.github/workflows/ci.yml)) publishes the live site —
the landing page, the instrument at `/play/`, and both books — from the build
it just checked, once `CI` is green on a push to `main`; a red run deploys
nothing and the last green build stays live. To redeploy by hand, run the *CI*
workflow on `main` from the Actions tab: it checks everything, then deploys. It
deliberately does **not** run on the tag. The `github-pages` environment permits
deployments from `main` only, so a tag-triggered deploy is rejected by protection
rules; and it is not needed, because the tagged commit is on `main`, and the
site deploys from `main` once its CI is green.

The release PR carries the `release` label, which puts it in a queue of its
own (`.mergify.yml`): the merge queue tests it alone and merges it alone, never
in a batch. So its merge commit's tree is exactly the tree the queue's full
gate tested, and that commit is the one to tag.

The steps, in order:

1. **Land everything first.** The tag goes on the release PR's merge commit,
   which the queue's full gate tested. The release workflow does not re-run
   the test suite, it packages what is already there.
2. **Bump the version** in the workspace `Cargo.toml`: `[workspace.package]
   version`, *and* the `version = "…"` on each intra-workspace dependency in
   `[workspace.dependencies]` and in `crates/auracle-wasm/Cargo.toml`. Cargo
   refuses to resolve a path dependency whose version requirement the member no
   longer satisfies, so a half-bump fails loudly at `cargo check` — run it.
3. **Close the changelog section.** Run
   `python3 scripts/changelog.py --release X.Y.Z YYYY-MM-DD` (`--preview`
   first shows what it will hold). It makes `## [X.Y.Z] - YYYY-MM-DD` newest
   first, as the rest of the file runs: every entry waiting in `changelog.d/`,
   the one merged last at the top, then what `## [Unreleased]` held. It
   deletes those files, leaves `## [Unreleased]` above it with only its note,
   and prints the order it used. Then write the short paragraph under the new
   heading that says what this release *is*. This text becomes the release
   notes verbatim, so write it for someone who has never seen the repo.
4. **Open a PR for 2 and 3 with the `release` and `queue` labels**, titled
   `release: X.Y.Z` and with its issue lines (`Refs #N` for an issue that
   tracks the release, or `No issue: the X.Y.Z release`), queue it
   (`@mergifyio queue`, until the label alone does: `docs/process.md` § CI and
   merging), and wait for the queue to merge it. The operator creates the
   `release` label once.
5. **Tag the release PR's merge commit, and push the tag:**

   ```bash
   git fetch origin
   git tag -a vX.Y.Z <sha> -m "Auracle vX.Y.Z"
   git push origin vX.Y.Z
   ```

   `<sha>` is the commit the release PR from step 4 merged as
   (`gh pr view <n> --json mergeCommit -q .mergeCommit.oid`), not `main`'s
   tip: a change merged after it ships in the next release. To take one into
   this release after all, run step 3's command again, with the same version,
   in a new PR, labelled `release` too. While `## [X.Y.Z]` is the section
   under `[Unreleased]` and `vX.Y.Z` isn't tagged, it folds what has merged
   since into the top of that section. Then tag that PR's merge commit.

6. **Watch the release workflow**, then check the things a green run does not
   prove:
   download the attached zip, serve it, and confirm the app boots from the
   bundle; and, once `main`'s CI is green and has deployed, load the live site
   (`/`, `/play/`, `/docs/`, `/reference/` and `/reference/api/`) to confirm
   the deploy landed and the routes resolve.

The release workflow **fails before building** if the tag and the workspace
version disagree, if `CHANGELOG.md` has no section for the tag, or if
`changelog.d/` still holds an entry (a change the tag ships that its notes
don't mention). All three are cheap to hit and expensive to notice later. An
asset labelled v0.3.0 whose crates all say `0.2.0` is a bug report waiting to
happen.

To rehearse the bundle locally without tagging anything:

```bash
make bundle         # → dist/auracle-web.zip, the same assembly the workflow does
```

---

© 2026 [Alex Nodeland](https://alexnodeland.com). MIT licensed.
