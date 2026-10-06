---
title: "Testing: every gate, what it proves, when to run it"
last_updated: 2026-10-06
related_adrs: [3, 5, 22, 23]
---

# Testing: every gate, what it proves, when to run it

## Purpose

To pick the right checks for a change without running everything, and to
know what a green result does and does not claim. The `check` skill applies
this table.

## The gates

<!-- Rows in alphabetical order of the gate's name (case and backticks
ignored; φ last). Add a row in its place, not at the end: two PRs that each
add one then conflict only when no row sorts between theirs. -->
| Gate | Command | Proves | Run when |
| --- | --- | --- | --- |
| All tests | `make test` (needs `cargo-nextest`: `make setup`) | The workspace, optimized, on nextest, every test in its own process ([The local loop](#the-local-loop)), and then the doctests (the examples are not built: `make lint` compiles them); includes `shipped_preset_wirings_are_current` (the shipped preset wirings match today's presets and named inputs) and `shipped_preset_wirings_measure_the_same_today` (a sample of them re-measures the same: standardizer, φ, wiring) | Before a commit that touches Rust or a preset |
| Browser smoke | `make smoke` | Boots clean, worklet registers, failure flows contained | After `make wasm` |
| Browser suite | `make browser-fast`, `make browser-slow` (see `tests/web/AGENTS.md`) | Every behaviour a spec names | Any app behaviour change; in CI the fast tier is part of the required `CI` check and the `@slow` and `@quarantine` specs run in the *Slow suite* ([CI tiers](#ci-tiers), [Flakes](#flakes)) |
| Browser, what a change reaches | `make browser-changed` (`REPEAT=3` runs the spec files the branch adds or edits three times each, and the rest once; [The two lanes](#ci-tiers), below) | The specs CI's fast lane picks, and for `main.js` the specs of the views its changed sections draw; for `worker.js`, the page or the engine, each view's sample | Every change the browser reads, before review; `REPEAT=3` before the push (the `ship` skill) |
| Changelog | `python3 scripts/changelog.py --check` and `python3 scripts/test_changelog.py` (in `make dev-check`, and both in CI's *What changed* job, on every PR) | Every entry waiting in `changelog.d/` is one or more `### Kind: title` sections with no heading that would cut a release's notes short, and `CHANGELOG.md` has the one `## [Unreleased]` a release closes, with its note and nothing else before its first `###`; the assembler's tests cover the parse, the note, the merge order, the release and folding into an untagged one (`changelog.d/README.md`) | A changelog entry, `scripts/changelog.py` |
| CI's Rust tiers | `make test-fast-tier`, `make test-slow-tier` | The workspace split the way CI splits it (needs `cargo-nextest`) | To reproduce a CI leg by name |
| Coverage | `make coverage` (needs cargo-llvm-cov and the `llvm-tools` component: `make setup`) | Each crate's line and function coverage from the fast tier is at its floor (`crates/coverage-baseline.json`), and every line changed in `crates/` since `origin/main` (`BASE=` for another) is covered; the HTML report is `target/llvm-cov/html/index.html` ([Coverage](#coverage)) | Any Rust change, before review; `make coverage-floors` in a PR that raises a crate's coverage |
| Crate tests | `make test-crate CRATE=<crate>` (`cargo test -p <crate> --profile test-fast --lib --bins --tests` with the pinned compiler; a bare `cargo` with Homebrew's first on PATH is not it) | That crate's gates | The crate you changed |
| Everything CI runs | `make check`; `make -j check` runs its parts side by side ([The local loop](#the-local-loop)) | fmt, lint, js, the spec lint, wasm32, tests | Before every commit |
| Film tools | `make dev-check` (its `dev-film-tests` part) | The films' sound stays one source (`www/brand/sound.py --check`), and the film tools' own tests pass: the timeline's grammar, the film's bed and marks, the mix to the ladder (`www/video/tools/test_*.py`). The mix's tests need numpy and scipy: locally from `.venv-voice`, in CI's Web job pinned from `www/video/requirements-tools.txt` | Any change under `www/video/tools/`, `www/video/sound/` or `www/brand/sound.*` |
| Format | `make fmt-check` | rustfmt is clean | Any Rust (a hook formats on edit) |
| JS syntax | `make js-check` | Every app script parses, including the worklet literal | Any JS (a hook checks on edit) |
| Lint | `make lint` | clippy with `-D warnings` | Any Rust |
| Model | `make fit-bench`, `make closed-loop` | The posterior still recovers a synthetic user | Model or budget changes |
| Mutants | `make mutants DIFF=1` (the code changed since `origin/main`, `BASE=` for another), `make mutants CRATE=<crate>` (needs cargo-mutants at the `Makefile`'s `MUTANTS_VERSION`: `make setup`) | A test notices when the code is wrong: every mutant cargo-mutants makes of the code (a function returning a default, a `<` made `<=`) fails a test of its crate's fast tier. Each survivor is named by file, line, function and change in `mutants.out/missed.txt` ([`crates/AGENTS.md` § Mutation testing](../../crates/AGENTS.md#mutation-testing)) | Any Rust change, before review; a survivor there keeps the PR out of the merge queue (its *Mutants* check is required: [CI tiers](#ci-tiers)) |
| Native and wasm agree | `make test-crate CRATE=auracle-wasm TEST_TARGETS="--test boot_agrees"`; the wasm half is `tests/web/boot_agrees.spec.js` (after `make wasm`, no page opened) | The shipped seed deals the same trees, vetting and standardizer natively and in the built wasm, both pinned to `crates/auracle-wasm/tests/boot_probe.json` | A draw from an RNG, the prior, vetting, the standardizer fit; regenerate with `UPDATE_BOOT_PROBE=1` and owe what a moved pool owes. No Rust test fails without the `gen_index` fix on a target CI runs (CI's hosts are 64-bit, where it changes nothing), so the spec is the only regression guard against a width-dependent draw |
| PR checks | `python3 scripts/pr_checks.py check --pr <n>` (reads the PR with `gh`); before a PR is opened, `PR_TITLE="…" PR_BODY="$(cat <body file>)" python3 scripts/pr_checks.py title` (and `links`); its tests, `python3 scripts/test_pr_checks.py`, are in `make dev-check` | A PR's title is a conventional subject; its body names each issue it finishes with a closing keyword of its own (`Closes #a, #b` fails: GitHub would close #a only), each it advances with `Refs`, or says why on a `No issue:` line; every issue named exists and is an issue, and none named with `Closes` is closed; a warning when `apps/web/`, `www/docs/src/` or `www/landing/` changed with no `changelog.d/` entry. `merged --pr <n> --dry-run` says what the merge job would do. The tests cover the parse, the title, the warning and the merge job on a fake API, with no network: the boxes it ticks among them (one issue; two, one still open; in a code block, a comment or a quote; a `<!--` in code, mid-line or never closed; ticked already; naming a PR; naming an issue closed as not planned; a run again, and one after a red run; a line changed between the read and the write; a read or a write that failed; another run's write putting a box back) | A PR's title or body before it is opened or edited; `scripts/pr_checks.py` |
| Preset wirings | `make perform-wirings` | Regenerates `apps/web/perform-wirings.json` (minutes, natively) | A preset, the phrase, φ (features, normalization, vetting, DSP), the grammar prior or PERFORM changed (`make test` says so) |
| Release | `python3 scripts/test_release.py` (in `make dev-check`); `python3 scripts/release.py plan --notes` gives the plan and the list, and changes nothing (it reads the PRs' authors with `gh`); the workflow's `dry_run` shows what its PR would hold | The version the PR titles since the last tag call for (a `feat` the minor, a `fix` or `perf` the patch, a `!` the major, or the minor while the major is 0), and a release prepared and not tagged folded into; the bump in every place the workspace writes its version and nowhere else, on a copy of the real workspace too; what a tag owes (`verify`, which release.yml and the workflow's tag job run: the workspace at the tag's version, its `CHANGELOG.md` section, `changelog.d/` empty); the list of what merged, by type, under a release's notes, and its link to the whole diff; the release PR's title and body passing `PR checks`, and its body and commit message claiming no bump for a fold; a malformed `CHANGELOG.md` or crate manifest refused in one line. On scratch repositories and a fake API, with no network | `scripts/release.py`, `.github/workflows/prepare-release.yml` or `release.yml` |
| Search health | `make search-check`, `make climb`, `make islands` | The search still improves the pool | Engine search changes |
| Site | `make site && make site-check` | The site builds; every link, asset and anchor resolves | Any `www/` change, public API docs |
| Spec lint | `make spec-lint` (in `make web-check`; needs `npm ci` in `tests/web`) | ESLint over `tests/web` (`eslint.config.mjs`): the Playwright plugin's recommended rules (no fixed wait, no missing `await`, web-first assertions, no assertion in a branch) and the house rules (the fixture, not `@playwright/test`; no `pageerror` listener of a spec's own; no clock on the runner; no `expect(await …)` straight after an action; a duration bound only as a budget, [ADR-022](../decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md); `window.__aur` only through named helpers). No file's count of a rule moves from `tests/web/eslint-suppressions.json` unrecorded: a rise fails, a fall is recorded with `--prune-suppressions`; against the merge base with `BASE` the file itself gains nothing (no count up, no new entry, no key for a file that is gone: `suppressions.mjs`); the lint's own tests pass (`eslint.test.mjs`); every test tagged `@quarantine` names its issue (`flakes.mjs check`, [Flakes](#flakes)) ([`tests/web/AGENTS.md` § The lint](../../tests/web/AGENTS.md#the-lint)) | Any change in `tests/web` (the after-edit hook lints a file there as it is edited) |
| Tokens | `python3 www/brand/tokens.py --check` (in `make dev-check`) | Every generated block is current; no color is written outside the tokens, in any styled page; a live figure reads only tokens, and aliases of them, that every page loading it defines; no token is redefined after its block; no file's count of literal font sizes, spacings, radii and durations (in its CSS, its scripts' styles, canvas fonts and animations, and the custom properties those use) has moved from `www/brand/sizes-baseline.json`, which is empty: every file is at zero, and what has no step says why (`www/brand/README.md` § The tokens) | Any stylesheet, a page's styles, a script that draws or styles |
| Voice | `python3 www/checkwords.py` (in `make dev-check`) | No file's count of banned words, em dashes or British spellings has moved from `www/brand/voice-baseline.json` (`www/brand/voice.md` § How this is kept) | Any copy: app strings, the site, the guide, the reference, the films, the README, the changelog and its entries in `changelog.d/` |
| wasm32 | `make wasm-check` | The engine compiles for the browser target, with no warnings (CI's engine build has `-Dwarnings`) | Rust in session or wasm |
| Web units | `make web-check` (`COVERAGE=1` also writes what the unit tests ran of `apps/web` as an lcov, for Codecov: [Coverage](#coverage)) | Syntax, plus the pure modules' unit tests (`apps/web/tests/`), plus the spec lint (the *Spec lint* row), plus the tests of CI's flake routing: which issue a failed test is said on (`tests/web/flakes.test.mjs`) and how (`.github/actions/file-issue/file-issue.test.mjs`); plus the timings the browser runners are dealt by, each test's median over its runs that passed (`tests/web/shard.test.mjs`); plus the tests of the specs a change selects (`tests/web/changed.test.mjs`: CI's selection names no spec for `main.js`, `worker.js` or the engine; `make browser-changed`'s follows the views, and tells the specs a branch edits, which `REPEAT` repeats, from those it reaches; every spec has a view, and every rule for `main.js`'s headings wins one) | Any JS, the Slow suite's or the Flake hunt's filing, the browser runners' deal |
| What a change reaches | `make check-changed` (since `origin/main`, `BASE=` for another; uncommitted and untracked files count); `-j` side by side | The parts of `make check` the change reaches, by the classifier CI's fast lane uses (`scripts/changes.py`), and the fast lane's jobs beyond `make check` it reaches, each with its command | Between edits; a change to Rust or to CI reaches all of `make check` |
| Worker protocol | `make worker-test` (after `make wasm`; `COVERAGE=1` as for the web units) | `apps/web/worker.js`, unchanged, in a Node worker thread over the built engine with no page: what it answers and in what order, its lanes and scheduling, and what reaches the farm's ports ([The levels](#the-levels)) | `worker.js`, `farm.js`'s messages, or Rust the worker calls (after `make wasm`) |
| Workflows and ops scripts | `make dev-check` (its `dev-ops` part): `node scripts/ops/check_workflows.mjs`, its tests (`scripts/ops/check_workflows.test.mjs`), the workflows' own tests (`scripts/ops/workflows.test.mjs`), and `scripts/ops/test_*.py`; the after-edit hook runs the check on a workflow as it is edited | Each saved Claude Code workflow (`.claude/workflows/`) parses; its `meta` is a pure literal the Workflow tool can read, with the file's name; every phase it names is declared and every declared one named; it calls no `Date.now()`, `Math.random()`, argless `new Date()` or Node API; and it runs to its end on stubbed agents for each sample of `args`, four ways (agents answering with the most data their schema allows, the least, none, and all but one, each in turn), with no stage throwing on valid data or on one agent's null, a stage's null ending its item as in the tool, every agent call labelled with the tool's options, a schema it accepts and no `undefined` in its prompt, and args passed as a string refused before any agent is spent. Every agent call also passes a `model`, `opus` or `sonnet` and nothing else, as a key of its own options object (a schema property named `model` does not count; the shorthand does), found in the source, so a call no sample reaches too, and again at run time. The check's own tests show it refusing each. The workflows' own tests run the real files on scripted agents: in `ship-issues`, `fix-flake` and `mutants-burndown` an item is `ready` only when every agent it needed came back (each agent killed in turn; a fix, a second round or a re-check that did not return leaves its blocking findings unresolved, and a fix that did not return leaves the should-fix ones undone), and `review-pr` puts each finding to a refuter of its own, two at one place too. Each workflow also has a table of its stages in `scripts/ops/workflows.test.mjs`, and its tests check that every stage runs on the model the table gives (opus for building, fixing, reviewing and the last gate on a finding, sonnet for finalizing and for what only lists or counts); that `models` changes its stage and no other, and a `ship-issues` item's `model` changes that item's build and fix and no other stage; that a bad `models` or `model`, or a stage the workflow has not, is refused before any agent is spent; that every prompt carries the advisor line except `triage-backlog`'s list of issues and `mutants-burndown`'s first measure, which only list or count; that every saved workflow has a table, and no table is left for one that is gone; and, for the six agent definitions in `.claude/agents/`, `model: opus` in the frontmatter and the advisor line, once, in the body. The operator's scripts: `rows_resolve.py`'s resolutions (a row edited on one side and one added on the other, rows added at one place, words added to one line, repeated lines) and refusals (a real overlap, no base); `queue_state.py`'s rule (each check by its latest run, a stale `dequeued` label, a `full-ci` PR's Slow suite once its run is complete); `ship_pr.sh` on a scratch repository and a fake `gh` (a PR opened by `gh pr create`, or through the REST API when that fails, or found by its branch when the REST create answers nothing; labelled, queued unless `--full-ci`, and nothing labelled when no PR is found); `wf_result.py` on an output file and a running run's journal (an agent that failed is said and does not read as running; blocking findings no re-check confirmed are a problem) ([`docs/process.md` § Waves](../process.md#waves)) | A workflow, a script in `scripts/ops/` |
| φ | `make revalidate` (both sides, diff), then `make perform-wirings`, then `cargo run -p auracle-features --example file_phi --release` | What the model can hear did not silently change; the shipped preset wirings are measured in the new φ; `FILE_MASKED` still names what a recording cannot measure (the mask gate test fails until it does) | Any φ, phrase, vetting or normalization change |

## The levels

A behaviour is tested once, at the lowest level that can prove it (#178):

| Level | Proves | Where |
| --- | --- | --- |
| Rust unit | One module's logic | The module's crate (`make test-crate`) |
| Rust engine | Engine behaviour through the crates' public API: the pool, duels, fits, walks, offers, names, persistence | The crates (`make test`) |
| Wasm binding | Only what the binding adds: shapes, errors, `u64` at the boundary | `crates/auracle-wasm` |
| Worker protocol | A message to `worker.js` and its reply, its lanes and its scheduling, with no page | `tests/worker/` (`make worker-test`) |
| JS unit | Pure logic in an `apps/web` module | `apps/web/tests/` (`make web-check`) |
| Browser | The wiring from a gesture to the engine and back, and what a player sees and hears: one spec for each wiring, not one for each engine case | `tests/web/` |

**The worker-protocol level.** `tests/worker/harness.mjs` runs
`apps/web/worker.js`, unchanged, as the module worker `main.js` starts, in a
Node `worker_threads` thread over the built engine in `apps/web/pkg`. It
gives the worker what a Web Worker has and Node does not (`self` with
`postMessage`, `onmessage` and `location`, the `unhandledrejection` event, a
`fetch` of the app's own files), compiles the wasm in the thread and hands
it to `init` as main does, and answers `farm_want` with no crew, as
`?farm=0` does. A test boots it (`workerFor`: seeded, with a pool of 12
where main asks for 40, so a boot is a few seconds and the pool's ids and
trees follow from the seed), sends what main sends (`send`
returns the replies that answer a request; `post`, `reply`, `until`) and
reads the thread's timeline (`trace`): every call the worker makes into
`WasmEngine`, in order with the messages it took and posted, noted from
outside on the glue's class, with the featurizations each rendered (`misses`,
the memo's misses during the call: 0 for an insert served from the memo). A request can be posted while a given engine
call runs (`post`'s `during`), as one of main's arrives mid-render, so a
lane rule is an order of events on one thread, and a slow machine makes it
slower, never wrong. A farm is ports the test holds (`fakeCrew`): what
reaches a farm worker, and in what order, is what its port heard. Its
workers render nothing: each render is answered as a draw that did not vet
(`ok: false`), so a restore on that crew takes the worker's own
`bank_render` path for every entry, never `bank_absorb`. A request goes
out numbered (`rid`), as main's `send` numbers it, and `send` and `answers`
take the replies that name it (`re`) up to the one without `more`
([The worker's replies](web-runtime.md#the-workers-replies)).

It has no page, no Web Audio or AudioWorklet, no media stream, no
IndexedDB (the face store is off) and no `farm.js`: what needs them stays in
the browser. A behaviour that moves here leaves its spec a check of the
page's wiring, or nothing where another spec already holds that.
`apps/web/tests/worker-lanes.test.mjs` and `worker-perform-replies.test.mjs`
still lift the worker's functions over a stub engine: milliseconds, and an
engine that traps on demand.

| File | Pins |
| --- | --- |
| `tests/worker/lanes.test.mjs` | A request posted during PERFORM's measurement, during the guess's renders, or during a spare offer's steps (a pick) is handed to the worker when the call in progress ends, before any other engine call, and answered before the job's next one; leaving the patch (`retire`) drops the spare at that breath, with no further step; with no crew the guess ranks the likeliest eight; PERFORM's lean (`perform_lean`) is null before a fit and after it each control asked for by its palette index, answered during the measurement by its one engine call |
| `tests/worker/background.test.mjs` | A measurement nobody waits on (`bg`) gives way to a cable probe asked for during it and finishes after it, where PERFORM's own keeps the floor; a measurement `retire` demoted is the player's again after `promote`, landing before a drift asked for after it, and without `promote` the drift lands first; an Offer asked for while the guess waits for its crew begins before the guess renders anything |
| `tests/worker/farm.test.mjs` | A capture hands every farm worker standing the phrase with the clip, and `farmResent` counts them; a restore of a session saved with a captured clip hands boot's crew that phrase before the first of the bank's renders |
| `tests/worker/bank.test.mjs` | A patch file opened twice lands once, and the second `import_patch` answers 0 with the sound it landed as (`duplicate`), though the import put the file in normal form (a quantizer over nothing folded away), so main opens that sound rather than call the file refused |
| `tests/worker/warm_start.test.mjs` | The warm start's cards are measured while the player chooses, a pick's card next; *teach it* is handed to the worker when the card being measured ends, inserts its first pick and the other cards measured with no render (the rest rendered once each), and measures no card after; with every card measured ahead, *teach it*'s replies, the saved session and the first fit are the ones a worker that measured nothing makes |

## The local loop

What a workstation runs between edits, and what keeps it short (#177 § 6).
The times are from the maintainer's 16-core Mac, which other work shares:
each comparison was taken back to back, with the load average beside it.

- **`make test` runs nextest**, every test in the workspace in one pool,
  each in a process of its own, then the doctests with `cargo test --doc`
  (nextest runs none; there are none today). `cargo test` ran the
  workspace's test binaries one after another, each waiting on its slowest
  test before the next began: 204 s against nextest's 158 s on a quiet machine (#177). At a
  load average of 46 to 143, three runs of each could not tell them apart
  (`cargo test` 390, 504 and 512 s; nextest 346, 487 and 609 s), and
  nextest used no more CPU (2,096 and 2,113 s against 2,139 and 2,145 s).
  It stops starting tests at the first failure, where `cargo test`
  finished the failing binary: `NEXTEST_ARGS=--no-fail-fast` runs them all.
- **`.config/nextest.toml` says what a test needs from that pool.** A test
  whose work runs in threads of its own for the whole test, one per seed,
  preset or core, declares how many (`threads-required`), so it doesn't
  slow every test beside it, and its time says what it costs: beside
  fifteen other tests the search floor took 422 s (at a load average of 90
  to 150), and declared, it ran alone in 112 and 164 s (46 to 98). Those
  tests run first (`priority`), while the pool is empty: nextest starts
  nothing new while a test waits for its slots. A test past a minute is
  reported slow, and one past twenty minutes is stopped, so a hung test
  ends with its name in the report. CI selects the file's `ci` profile
  (`NEXTEST_PROFILE=ci`): stopped at ten minutes, inside a job's limit, and
  a JUnit file with every test's time. cargo-mutants keeps the default
  profile, where its own time limit comes first. Which tier a test is in is
  still the `Makefile`'s (`SEARCH_FLOOR`, `SLOW_TESTS`).
- **Test builds are incremental** (`incremental = true` in
  `[profile.test-fast]`). After an edit to a function's body, the test binaries rebuild in 10 s
  instead of 61 (an edit to the grammar, which three other crates build
  on) and in 11 s instead of 41 (the session crate): medians of six each,
  at a load average of 77 to 136. The tests run as fast: six of the
  heaviest used 83 and 86 s of CPU built incremental, 84 and 82 s built
  whole. It costs disk: 0.9 GB of the 1.3 GB under `target/test-fast`.
  CI sets `CARGO_INCREMENTAL=0`, which overrides it, since every build
  there starts from a cache that the incremental state would only bloat;
  `make coverage` sets it too, since each of its runs starts clean.
- **`make -j check` runs its parts side by side.** Cargo locks each
  profile's directory on its own, so `lint` (debug), `wasm-check` (the
  wasm32 release build) and `test` (`test-fast`) build at once, beside
  `web-check` and `dev-check`, and no cargo waits on another's directory.
  What that saves is small now: with incremental builds the rebuild after
  an edit takes seconds, and the test run is most of `make check`. After
  an edit to the session crate, at load averages of 32 to 122, `make check`
  took 559 and 575 s and `make -j check` 538 and 704 s; in the first pair
  the test run was 464 and 517 s of it. Plain `-j`: macOS ships GNU Make
  3.81, which has no `-O`; on GNU Make 4, `-j -O` keeps each part's output
  together. The pre-commit hook runs `dev-check` with `-j8`.
- **`make check-changed` runs the parts of `make check` your change
  reaches**, since the merge base with `origin/main` (`BASE=` for another),
  uncommitted and untracked files included, by the classifier CI's fast lane
  uses (`scripts/changes.py`, [The two lanes](#ci-tiers)). Rust or CI
  reaches all of it; the app, the docs, the specs or a script, `web-check`
  and `dev-check`; anything else (a changelog entry, the worker-protocol
  tests) the voice and the changelog's checks that CI runs on every PR. It
  also names the fast lane's jobs beyond `make check` that the change
  reaches (Site, Worker protocol, Browser smoke, the specs it reaches), each
  with its local command. `make -j check-changed` runs the parts side by
  side.
- **sccache, opt-in.** With `AURACLE_SCCACHE=1` in the environment (put it
  in your shell's profile; `make setup` then installs sccache, as
  `scripts/setup.sh --sccache` does), every cargo call `make` makes
  compiles through it. Each worktree keeps its own `target/`: one target
  directory shared between worktrees is not safe here, since cargo judges
  freshness by file times and bakes `CARGO_MANIFEST_DIR` into test binaries
  (the main checkout once ran a test binary built from a copy of the
  workspace, which read the copy's fixture). sccache keys each compile by
  its inputs, the `CARGO_*` variables among them, so only what is the same
  in every worktree, crates.io's dependencies, comes back from its cache,
  and an incremental compile (the workspace's crates under `test-fast`) is
  never cached. A new worktree's first builds (the tests, clippy and the
  wasm32 check, as `make check` builds them) took 99, 130 and 146 s from a
  warm cache against 117, 160 and 160 s without one, at load averages of
  27 to 59: 146 of the 198 compiles it can cache came back from it, and it
  never caches a build script or a procedural macro (161 calls).

## CI tiers

CI runs in two tiers, and the PR checks and the PR's *Mutants* job run
beside them. A PR may merge on the fast tier, the PR checks and its
*Mutants* job alone.

<!-- A new tier's row goes at the end. With so few rows no order keeps two
added rows apart, so two PRs that each add one conflict here:
scripts/ops/rows_resolve.py keeps both. -->
| Tier | Where | Runs | Gates merging |
| --- | --- | --- | --- |
| Fast | `.github/workflows/ci.yml`, the `CI` check, in two lanes ([ADR-023](../decisions/023-the-gate-runs-in-the-queue.md)) | The voice check and the changelog's (`scripts/changelog.py --check` and its tests), in *What changed*, on every run; Lint; Web (`make web-check`, then `make -j4 -O dev-check`, its parts side by side); the engine for the browser, once per run (a wasm32 build under `-Dwarnings` when a crate, the Cargo files or the Makefile changed, main's cached build otherwise); Site (built with that engine); the worker-protocol tests (`make worker-test`, against the same engine, once it is built); the Rust tests not named slow, instrumented for coverage (built once, run on three runners by slice, then one report: [Coverage](#coverage)); the doctests; every browser spec not tagged `@slow` or `@quarantine` (twelve runners, dealt by time). That is the full gate, the merge queue's run. A PR's own run is the fast lane, the part of it the change reaches, with Browser smoke (`make smoke`'s two specs) in place of the browser specs it can't pick (*The two lanes*, below) | Yes. The branch ruleset requires `CI` on a PR's head (the fast lane); the queue merges on the full gate's `Full gate` |
| PR checks | `.github/workflows/pr-checks.yml`, the `PR checks` check, on every change to a PR's title, body or commits (not the queue's draft PRs) | The PR checks gate above on the PR's own title, body and files. On merge, its *Issues on merge* job comments on each `Refs` issue, closes each `Closes` issue GitHub didn't, tells each closed issue's parent its count of sub-issues closed, and ticks each box in another open issue that names an issue that closed, once every issue the box names is closed as completed | Yes. Mergify's queue conditions require it (`.mergify.yml`), so a PR enters the queue only once it is green; not the ruleset, and not the queue's merge conditions |
| Slow | `.github/workflows/slow-suite.yml`, *Slow suite* | The search floor (`make test-search-floor`); the other slow Rust tests (`make test-slow-rest`); every `@slow` browser spec (six runners, three at a time, dealt by time); then the `@quarantine` ones on a runner of their own, whose failures are said on each test's issue and never turn the run red ([Flakes](#flakes)). On a PR only with the `full-ci` label | No |
| Flake hunt | `.github/workflows/flake-hunt.yml`, nightly | The fast tier's browser specs three times each, against main, on twelve runners four at a time; each test that fails is filed on its own `Flaky:` issue, and the runs that pass refresh the fast tier's timings ([Flakes](#flakes)) | No |
| Speed budgets | `.github/workflows/flake-hunt.yml`, nightly, beside the hunt | Every spec file that records a budget, each test once (`@slow` ones too), against main, with `AURACLE_PERF=1` at `AURACLE_CPU_THROTTLE=1`, on two runners; a budget over its limit files *Speed budgets over their limit* ([Rules](#rules)) | No |
| Mutants | `.github/workflows/mutants.yml`, *Mutants*, on a PR; `.github/workflows/mutants-weekly.yml`, *Mutants weekly*, weekly and by hand | On every PR, the mutants in the changed code (`make mutants DIFF=1`'s; none when no Rust changed) on one runner for at most 25 minutes, red when one survived; weekly and by hand, one part of the workspace (four shards, two runners at a time; a fifteen-week cycle aims to cover it all), or by hand every shard of the crates named, a survivor on `main` filing *Mutants that survive* ([Mutants](#mutants)) | Yes, on a PR. Mergify's queue conditions require its `Mutants in the changed code` (`.mergify.yml`, #181), so a PR enters the queue only once it is green: red on a survivor in the changed code or a broken run, never on time alone. Not the ruleset, and not the queue's merge conditions (on the draft PR it passes at once). *Mutants weekly* gates nothing |
| Codecov | Steps in `ci.yml`'s Coverage, Web and Worker protocol jobs (`.github/actions/codecov`), set up by `codecov.yml`; on `main`, when it reuses the queue's verdict, a job of its own (*Codecov from the queue's run*) that nothing waits for | Uploads three lcovs, one flag each (`rust`, `web`, `worker`), from a PR's own run and from `main`, not from the queue's run. Codecov comments on a PR whose run uploaded one, condensed, and keeps the trend on `main` ([Coverage](#coverage)) | No: its statuses are informational, an upload never fails a job, and the gate is `scripts/coverage_gate.py` |

**The two lanes.** One workflow, and its *What changed* job picks the lane. A PR's paths are classified by `scripts/changes.py`, which `make check-changed` runs on a workstation too, so the two agree on what a change reaches:

| Change | A PR's own run (the fast lane) |
| --- | --- |
| Docs, the site, `.claude/` or an `AGENTS.md` | Web, the engine (restored), Site |
| Spec files only | Web, the engine, Site, and those specs (one runner per file, up to four); more than twenty, Browser smoke instead |
| The specs' lint (`eslint.config.mjs`, `eslint-suppressions.json`, its tests) | Web, the engine, Site; beside spec files, those specs as above. No browser reads the lint |
| `main.js`, `worker.js`, `index.html`, `style.css` | Web, the engine, Site, then Browser smoke; Worker protocol; no other spec |
| An app module `changed.mjs` maps (`patch.js`, `perform.js`, `faces.js` …) | Web, the engine, Site, then Browser smoke, Worker protocol, and that module's specs on up to four runners |
| A test helper (`fixtures.js`, `shell.js`), the Playwright config, the lockfile | Web, the engine, Site, then Browser smoke; the specs a helper reaches when they are twenty files or fewer |
| A crate, `Cargo.*`, `rust-toolchain.toml`, the `Makefile` | Lint, Coverage, the Doctests, Web, the engine (built), Site, then Browser smoke; Worker protocol |
| The coverage gate's scripts, `scripts/setup.sh`, nextest's config (`.config/nextest.toml`) | Lint, Coverage, the Doctests, Web, the engine, Site, Worker protocol |
| The worker-protocol tests (`tests/worker/`) | The engine (restored), Worker protocol |
| Another script (`scripts/*.py`: the changelog's assembler, the PR checks, and their tests; anything in `scripts/ops/`: the operator's scripts and the workflows' check) | Web, whose `dev-check` runs the scripts' tests |
| A changelog entry (`changelog.d/`) | Nothing more: *What changed* checks the entries and the voice on every run, and the site doesn't read them |
| A workflow or an action (`.github/`), or the classifier (`scripts/changes.py`) | The full gate, as the queue runs it |

- **The fast lane** narrows by the paths the PR changed. Its browser specs
  are the ones `tests/web/changed.mjs` picks: a changed spec, the specs that
  require a changed helper, the specs named for a changed app module, one
  runner per file up to four, dealt by time. A change that reaches every
  level (`main.js`, `worker.js`, the engine) picks none, and gets the smoke
  only (with Worker protocol, which is the fast lane's real check of
  `worker.js`); so does a change that reaches more than twenty spec files (a
  helper nearly every spec requires, or that many specs changed at once). A
  green fast lane, with the PR checks and the *Mutants* job green beside it,
  puts the PR in the queue. It is not the gate: a `main.js` change has run
  two specs in CI when it enters the queue.
- **On the builder's machine, before that,** `make browser-changed` runs
  the same selection and follows the views too (`changed.mjs --views`):
  for `main.js`, the specs of each view (PERFORM, PATCH, EVOLVE, TASTE, the
  bank, the shell) its changed lines are drawn in, told by their section
  headings, and each view's sample for a section no view names; for
  `worker.js` and the engine, each view's sample (a spec or three per view,
  end to end) and `boot_agrees.spec.js`; for the page, the samples. Before
  the push it runs the spec files the branch adds or edits three times
  each, and the rest once (`REPEAT=3`, the `ship` skill), on the release
  engine (`make wasm`, or `make pkg-reuse` in a worktree that changed no
  Rust; a `make wasm-dev` build, or one a build left unfinished, is
  refused).
- **The full gate** is the merge queue's run: CI on the draft PR Mergify
  opens for a batch of up to three PRs (a release PR alone), from a branch
  under `mergify/merge-queue/`. Everything runs, as on `main`, on the tree that
  lands. There is no Browser smoke job there, since the browser tier runs its
  two specs itself. The `Full gate` job, green when `CI` is, is the check
  the queue merges on; it is a check of its own because Mergify merges a
  one-step queue's PRs without a draft PR when they are on `main`'s tip.
- A push to `main` and a run by hand are the full gate too.

**How long.** The fast tier's browser tests are about seventy-five minutes
of test time in one worker (284 tests at `42bd322`, each a fresh boot), so
they set the full gate's length: about twelve minutes, the engine job and
twelve runners planned at about six minutes each (the hosted runners differ
in speed by about two times, and each shard's log and the run's summary name
its CPU). Coverage takes about nine, estimated (a build, three runners and a
report: [Coverage](#coverage)); the Doctests two or three (a compile); Web
and Site two to three. So a PR's fast lane is about five minutes for docs,
and up to about ten when Rust changed (Coverage sets the length) or an app
module's specs run (`patch.js` reaches about 23 test-minutes, on four
runners).

**Dealt by time.** Playwright's `--shard=k/N` cuts the list into runs of
equal count, which left one of five runners with twice another's work.
`tests/web/shard.mjs` weighs each test by its time on main's last run and
deals the longest first, each to the emptiest runner, so the runners finish
together. The deal is a partition only if every runner reads the same
timings, so the engine job reads them once per run (from the Actions cache)
and uploads them as an artifact every runner downloads, a re-run's included;
each runner prints the plan's hash, the same on every runner of a run. A
test with no time yet weighs the median; with no timings the split is by
count. `node shard.mjs plan --shards 12 -- --grep-invert "@slow|@quarantine"`
in `tests/web` prints a split without running it.

**One report.** Each runner keeps a blob report, uploaded whatever its
end, a failed or cancelled job's included; the *Browser report* job merges a
run's into one HTML report, every test with the traces of what failed,
uploaded when a runner failed and linked from the run's summary
(`npx playwright show-report <dir>` opens it). The summary also lists every
speed budget a test recorded over its limit (`shard.mjs budgets`), which the
gate records and never fails on. In the merge queue's run and on main it
also folds the run's times into the timings the next run deals by, each
test's time from its runs that passed (*The timings come from the queue's
run*, below). A runner that would
outlast its job ends first: Playwright's global timeout
(`AURACLE_GLOBAL_TIMEOUT_MIN`) sits five minutes under the job's limit, and
a minute before it `shard.mjs` interrupts the run, so the test that was
running is reported as interrupted, with its trace.

**In Playwright's image.** Every job that runs a browser (the fast tier's
runners, Browser smoke, the *Slow suite*'s, the flake hunt's and the speed
budgets' runners) runs in `mcr.microsoft.com/playwright:v<version>-noble`, with
`--ipc=host --init`. It has Chromium and its system libraries, so no job
installs them: they were apt packages fetched from Ubuntu's mirror on every
run, and a slow mirror twice took a shard past its job limit (#162). The
version is the `@playwright/test` that `tests/web/package-lock.json` locks,
read by each workflow's engine job, so a bump of it moves the image in the
same PR and the image's browser is always the one that Playwright looks for.
Its `npm ci`, the one network step left in the setup, is cut at three
minutes with a message naming the registry; the image's pull, which
happens before any step, is bounded by the job's limit.
`.github/actions/playwright` says why the image and why those options.

**On main, what the queue already passed is not run again.** A push to main
is a squash merge by the merge queue
([ADR-023](../decisions/023-the-gate-runs-in-the-queue.md)), which merges
each PR of a batch on its own once the batch's full gate is green. After the
batch's last merge, main's files are exactly the files that run tested (a
pull_request run tests the draft PR merged into main). The queue's run
leaves a record (its `CI` job writes the artifact `verified-tree-<git
tree>`, kept 14 days) of the jobs that passed on those files, and main's
*What changed* job reads it: Lint, Web, the Doctests, Coverage, Worker
protocol and the browser tier are skipped there when the record says they
passed, and the
run's summary says so, with a link. Only a queue run's record counts: a PR's
fast lane runs part of the gate and leaves none. Everything runs on main
when no record matches (a merge by hand, outside the queue), on a manual
run, and for a PR from a fork. The Site job always runs on main: its build
is what deploys. The *Slow suite* and the nightly flake hunt still run in
full.

**Latest only.** A batch lands as two or three merges seconds apart, and
only the last one's files are the files the queue tested. So main keeps its
latest run only (`queue: single`): a run in progress is not cancelled, the
newest waiting run replaces any older one, and a run whose commit main has
already moved past runs nothing and says so in its summary, its `CI` green
with every job skipped. The newest push's run covers it. A run that reads
main's tip before the batch's next merge has landed finds nothing newer, and
runs in full. The *Slow suite* on main does the same.

**The site deploys from CI.** On main, the Site job keeps the site it built
and checked, and the *Deploy to Pages* job publishes it once `CI` is green;
a red run deploys nothing and the last green build stays live. Lint, the
Doctests and Coverage are reused only while `rust-toolchain.toml` still
pins the release they ran on (the record keeps `rustc --version`). After a
batch that changed `rust-toolchain.toml` or `Cargo.lock`, Lint and Coverage
run on main anyway: their caches are saved from main only, under a key that
holds the compiler's release and the lockfile, so reused they would never be
saved for a new compiler or a bumped dependency.

**The timings come from the queue's run, and from the nightly hunt.** Main
no longer runs the browser tier when it reuses the queue's verdict, so the
queue run's *Browser report* folds its times into main's timings and keeps
the file as an artifact, and main's *What changed* job saves it to the cache
the next run deals from (a cache saved by a pull_request run is restored by
that PR's runs only). The nightly *Flake hunt* runs the whole tier on main
three times, and its report folds in each test's median of the runs that
passed, so the timings stay current when main's pushes skip the tier
(reused, or superseded by a newer push). A test that never passed keeps the
time it had.

**The workflows themselves.** Each workflow's token is read-only unless a
job needs more (filing an issue, deploying Pages, a release's branch, PR,
tag and GitHub Release). Every job runs on
`ubuntu-24.04`, not `ubuntu-latest`, so a new runner image arrives in a PR of
its own, and every Rust job builds with the compiler `rust-toolchain.toml`
pins (`rustup toolchain install`), as `make` does locally, so a new Rust
release does too. Every action is pinned to
a commit SHA with its version in a comment; Dependabot
(`.github/dependabot.yml`) opens one grouped PR a week for the actions and
one for `tests/web`'s npm packages (whose `@playwright/test` is also the
tag of the browser jobs' image, so its bump is one PR).

**When the slow tier runs.** On `main`, in full: the newest push (its run
covers the pushes before it; [Latest only](#ci-tiers)), and nightly. A
failure there opens an issue titled *Slow suite failing on main*, or comments
on the open one. A quarantined test's failure is not one: it is said on that
test's own issue, and the run stays green, so the issue means a new
regression, or a quarantined test whose issue was closed
([Flakes](#flakes)). On demand from the Actions tab. On a PR, only when the
PR carries the `full-ci` label: adding it starts a run, and every push to
the labelled PR runs it again; a PR without it runs nothing there. Add it to
a PR that changes what the slow tests cover, the paths the workflow used to
run a PR for: any crate, `Cargo.toml` or `Cargo.lock`,
`rust-toolchain.toml`, the `Makefile`, `.config/nextest.toml`, `slow-suite.yml`
or `.github/actions/`;
`apps/web/`'s `worker.js`, `farm.js`, `perform.js`, `patch.js`,
`live-audio.js`, `audio-in.js`, `explain.js`, `faces.js` or `vessel.js`;
`tests/web/`'s `fixtures.js`, `playwright.config.js`, `package.json` or
`package-lock.json`; or a spec file that holds an `@slow` or `@quarantine`
test. Also a `main.js` change that reaches EVOLVE's generations or PERFORM's
offers. Otherwise the push to `main` is where a slow test catches it.

**Runners.** The account runs at most 20 jobs at once.
- **The queue's run** at its widest holds about 18: twelve browser runners,
  Site, Worker protocol, the three Coverage runners, and one more for a Lint,
  Web or Doctests job still running, or the *Browser report*. One batch is tested at a
  time.
- **A PR's fast lane** holds at most twelve: four browser runners, the three
  Coverage runners, Site (then Browser smoke, which waits for Site and takes
  its place), Worker protocol, and Lint, Web and the Doctests while they
  last. Only a PR that changes both Rust and an app module with specs of its
  own reaches that. A docs PR holds two (Web, then the engine and Site), an
  app PR without Rust six or seven, a Rust PR eight.
- **The *Slow suite*** holds at most four (`max-parallel`: one Rust leg and
  three browser runners; the quarantined tests' runner starts once all six
  browser runners are done), on `main`, latest only.
- **After a merge**, main's `CI` reuses the queue's verdict and runs the
  engine and Site for the deploy, and beside them the upload of the queue
  run's coverage to Codecov ([Coverage](#coverage)): three.
- ***Mutants*** ([Mutants](#mutants)) holds one runner a PR for up to forty
  minutes (the job's limit; the run inside stops at 25), well after a crate
  PR's fast lane is done, and for about a minute on a PR that changes no
  Rust. A PR enters the queue only once it ends. *Mutants weekly* holds two
  on Saturdays, for about eleven hours from 09:17 UTC.

So the queue's run and the *Slow suite* together are 22, two over: a merge
starts the *Slow suite* just as the queue starts its next batch, and that
batch can wait a few minutes for a runner. A PR's fast lane beside a queue
run fits when it is small (a docs or app PR) and waits for a few runners
when it is wide. Before two lanes, every PR's run was the full gate at 19
(the two plain Test runners as well), and a second PR in CI could not fit
beside it. *Mutants* adds a runner for each crate PR in flight: a crate
PR's fast lane (eight) and its *Mutants* job are nine, two such PRs
eighteen, and a queue run beside two crate PRs' *Mutants* jobs, once their
fast lanes are done, twenty. On Saturdays the weekly run's two leave
eighteen: a queue run just fits beside it, and a *Mutants* job or a crate
PR's fast lane then waits for runners. At night the *Flake hunt* holds four
and its *Speed budgets* two, beside *Search health*'s three long jobs: nine
in all.

**What is slow.** Rust: the tests that took over a minute on a runner, named
in the `Makefile` as `SEARCH_FLOOR` (`refinement_improves_pool`, about five
and a half minutes, a runner of its own) and `SLOW_TESTS`. Browser: a test
over about 40 s on CI is tagged `@slow` in its declaration
(`tests/web/AGENTS.md` says how); `npx playwright test --list --grep @slow`
lists them. The tag and the `Makefile` are the lists; this page does not
repeat them, so they cannot disagree.

**Exactly one tier each.** The fast tier is defined as the complement of the
slow one: `not (SEARCH_FLOOR | SLOW_TESTS)` for nextest, `--grep-invert
"@slow|@quarantine"` for Playwright. A new test is fast until someone names
or tags it; a renamed slow Rust test falls into the fast tier rather than out
of both; a slow list that matches nothing fails its leg (`--no-tests=fail`).
`make test` and `make check` still run every Rust test locally.

## Coverage

The fast tier's Rust tests, instrumented by
[cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) with the pinned
compiler's `llvm-tools`. What the gate holds, how to read it and what is
measured are the crates' rules, in
[`crates/AGENTS.md` § Coverage](../../crates/AGENTS.md#coverage).

**In CI**, in a PR's fast lane when it changes Rust, in the merge queue's
run, and on `main` unless the queue's run passed them on the same files,
inside the required `CI` check: three jobs, the way cargo-llvm-cov merges runs
made on several machines. They are the Rust tests' gate as well: a failing
test fails its runner, and there is no uninstrumented run beside them.
`make test-fast-tier` runs the same tier uninstrumented, locally.

1. *Coverage build* builds the instrumented test binaries once, into a
   nextest archive (`make coverage-archive`).
2. *Coverage (1/3)* to *(3/3)* each run a slice of the archive
   (`make coverage-run`, with `--partition slice:k/3`) and keep their
   profiles. They compile nothing and fetch nothing.
3. *Coverage* reads every runner's profiles against the archive
   (`make coverage-report`): each crate against its floor, the floors against
   their copy at the merge base, and the changed lines. The run's summary
   has the table and every uncovered changed line, linked; the HTML report
   is the `coverage-report` artifact.

**How long.** Instrumented, the tier takes about 1.2 times its plain time
(1,257 test-seconds against 1,029, measured on a 16-core Mac on Oct 5), so
about twelve minutes on one runner, and about nine on three with the build
and the report around them: an estimate until a run on a runner measures
it, and inside the browser tier's path. #181's first measurement, twenty
minutes, was cargo-llvm-cov 0.6, which instrumented every dependency,
quiver's DSP loops included; 0.7 and later instrument the workspace's
crates alone, and the Makefile and CI ask for 0.9.1.

**Instead of Test.** The two plain Test runners ran the same tests
uninstrumented, beside these. They are folded in: the tests run once, and
two runners come back ([Runners](#ci-tiers)). The doctests, which nextest
doesn't run, have a *Doctests* job of their own.

**Locally.** `make coverage` (about two minutes on a 16-core Mac) runs the
whole tier, writes `target/llvm-cov/html/index.html`, `lcov.info` and
`summary.json`, and runs the same gate against `origin/main` (`BASE=` for
another). `make coverage-report` runs the gate again without the tests, and
`make coverage-floors` raises the floors to the last run's values.
`make setup` installs cargo-llvm-cov and the `llvm-tools` component.

**Codecov, a view.** The gate is `scripts/coverage_gate.py`, above, and
nothing else. Codecov (`codecov.yml`) shows coverage on a PR and over time
on `main`, and never holds up a merge: its project and patch statuses are
informational, and no upload can fail a job: each calls
`.github/actions/codecov` in a step with `continue-on-error` and a
three-minute limit, which its job's own limit has room for (a job that
reaches its limit is cancelled whatever its steps say). Three lcovs go up,
one flag each:

| Flag | From | Measures |
| --- | --- | --- |
| `rust` | *Coverage*: the lcov the gate reads (`target/llvm-cov/lcov.info`) | The fast tier's Rust tests over `crates/` |
| `web` | *Web*: `make web-check COVERAGE=1` (`target/js-cov/web.lcov`) | What the unit tests in `apps/web/tests/` run of `apps/web` |
| `worker` | *Worker protocol*: `make worker-test COVERAGE=1` (`target/js-cov/worker.lcov`) | What `tests/worker/` runs of `worker.js` and what it loads (`render-store.js`), in its thread |

The two JavaScript lcovs are Node's own coverage (`--experimental-test-coverage`),
with the tests and the generated `pkg/` left out. They count what the Node
tests reach, not what is tested: the browser specs run most of `apps/web`
and are not measured. A line of `perform.js` that only a spec runs reads
as uncovered, and a file no Node test loads (`main.js`) is not in the
report at all. That is why Codecov's annotations on the diff are off.

The uploads go from a PR's own run and from `main`, never from the merge
queue's run, whose draft PR's commit never lands on `main`. `main` usually
reuses the queue's verdict and runs none of the three jobs, so a job of its
own, *Codecov from the queue's run*, uploads the queue run's reports as
`main`'s, measured on the same files (the `coverage-report`, `coverage-web`
and `coverage-worker` artifacts). Neither `CI` nor the deploy waits for it,
so a stalled upload can't hold up either: it holds `main`'s run open for up
to the job's fifteen minutes (a push meanwhile waits, as `main` runs one at
a time), and with `continue-on-error` on the job, a failure there leaves the
run green. Elsewhere each upload is a step in a job already counted under
[Runners](#ci-tiers). A PR's fast lane runs only the jobs its change
reaches; a flag a commit didn't upload is carried forward from its parent,
so it doesn't read as a drop, and a PR whose run reaches none of the three
jobs gets no comment. A PR from a fork gets no secrets, so its upload goes
without the token, as Codecov allows from forks of a public repository.

Locally, `make web-check COVERAGE=1` and `make worker-test COVERAGE=1`
write the two JavaScript lcovs (Node 22.5 or later); without `COVERAGE`
the gates run as before, with no coverage.

## Mutants

[cargo-mutants](https://mutants.rs) over the fast tier: each mutant, a small
change to the code, is built and its crate's fast tier run on it, and a
mutant no test fails on survives. What it runs, how to read a survivor and
what review does with one are the crates' rules, in
[`crates/AGENTS.md` § Mutation testing](../../crates/AGENTS.md#mutation-testing).
Two workflows run it, each part of neither `CI` lane: *Mutants*
(`mutants.yml`) on every PR, and *Mutants weekly* (`mutants-weekly.yml`)
over the workspace, weekly and by hand. The PR's check,
`Mutants in the changed code`, is required by Mergify's queue conditions
(`.mergify.yml`, #181), beside `CI` and `PR checks`: a PR enters the merge
queue only once it is green. Not by `main`'s ruleset, and not by the
queue's merge conditions: on the queue's draft PRs (branches under
`mergify/merge-queue/`) the job passes at once, about a runner-minute a
batch, since each PR's own run has judged its code. It still runs there, so
its check shows green rather than skipped.

They are two workflows so that only a PR's run posts that check. As one,
a run by hand from a PR's branch put the PR job's check on the PR's head
commit too, skipped by the job's condition (it put one on #265's). If
Mergify reads a check by its latest run, as its open-source engine did, a
skipped one that ended after the PR's own run would keep the PR out of the
queue.

**On every PR**, one runner tests the mutants in the changed code
(`make mutants DIFF=1`'s command against the merge base, in place, one at a
time) for at most 25 minutes, the unmutated build and tests included, then
stops and reports what it judged. It runs `make -s mutants-command`'s
command itself rather than `make mutants`, whose exit code is make's 2 for
any failure, so it reads cargo-mutants' own: a survivor, a timeout, the
unmutated tests failing, a diff that doesn't match the tree, or the run
breaking. A PR that changes no Rust in `crates/` passes at once; the
workflow has no `paths:` filter, which would leave the required check
waiting, never run, on such a PR. The run's summary has the table and
every survivor and timeout, linked.

**What a red job means for a PR.** The job is red when a mutant of the
changed code survived, or when the run broke (the unmutated tests failed,
or cargo-mutants did), and red keeps the PR out of the merge queue. A
survivor is killed on the branch with a test that asserts what the code
does, or, when no behavior can show it (an equivalent mutant), excluded
narrowly in `.cargo/mutants.toml`'s `exclude_re`, by file,
function and change, with its reason
([`crates/AGENTS.md` § Mutation testing](../../crates/AGENTS.md#mutation-testing));
the push runs the job again. A timeout is reported and passes. A run the
cap stops before the unmutated tests are done judges nothing and passes,
with a warning on the PR's checks; one it stops later passes unless a
mutant it judged survived. So no PR is held by time alone, and a PR that
touches no Rust passes at once. A crate PR's job ends up to 40 minutes
after it starts, often after its fast lane, and the PR enters the queue
then.

**Weekly** (Saturdays, 09:17 UTC) **and by hand**, *Mutants weekly* runs
one part of the workspace: each crate's mutants are cut into shards (`PLAN` in the `plan`
job: taste 1, grammar 4, features 16, session 26, wasm 11), and each week
runs the next four, two runners at a time, each stopped at five and a half
hours. Fifty-eight shards make fifteen parts, so a fifteen-week cycle aims
to cover the workspace. The cover is approximate: a shard is a slice of
its crate's mutants in source order on the day it runs, so code that
changes between weeks moves the slices' edges, and a mutant near one can be
tested twice in a cycle or not at all. Weeks run Monday to Sunday, so a
run by hand takes the part of its week's Saturday (on a Sunday, the day
before's), unless its `part` input names another (its summary lists them
all). A week whose run is dropped
leaves its part to the next cycle. A run on `main` that finds a survivor,
or a shard that left no outcomes, files or comments on *Mutants that
survive*, naming its part.

**A burn-down, by hand:** the `crates` input runs every shard of the crates
it names instead of a part, and `parallel` sets how many at once (two by
default, at most twelve). Each shard uploads its own outcomes as it ends, so
its survivors can be killed while the others still run. Twelve runners leave
the queue's full gate eight, so a batch waits for runners while a wide
burn-down runs. Run from a branch, it files nothing, and it puts no
`Mutants in the changed code` on the branch's PR; the burn-down's PRs carry
the survivors (#181), each judged by its own run.

**How long.** Measured on Oct 6 on a 16-core Mac shared with other work,
two mutants at a time. The runs at `db2103f` were at `nice -n 19`, under a
load of 17 to 76, with the timeout at 3 times the unmutated time (it is 5
now: `.cargo/mutants.toml` says why); the run at `cf61f48`, after taste's
PR (#198), was at 5, as were the runs at `47a0d4f`, before #207's changes
and with them. The last ran under a load of 22 to 181, beside other
builds, so its times are three to five times the others'; the share of
the suite a mutant's tests took compares across loads.

| Run | Mutants | Wall time | Caught | Survived | Timed out | Unviable | A mutant, on average |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `auracle-taste` at `47a0d4f` with #207's changes, whole | 601 | 70 min | 575 | 0 | 0 | 26 | 13 s to build, 0.7 s of tests (of a 21 s suite) |
| `auracle-taste` at `47a0d4f`, whole | 631 | 23 min | 520 | 85 | 0 | 26 | 3.0 s to build, 1.3 s of tests (of a 4.3 s suite) |
| `auracle-taste` at `cf61f48`, whole | 619 | 18 min | 506 | 87 | 0 | 26 | 2.3 s to build, 1.1 s of tests (of a 4.7 s suite) |
| `auracle-taste` at `db2103f`, whole | 622 | 29.4 min | 428 | 166 | 2 | 26 | 3.1 s to build, 2.5 s of tests (of a 4.7 s suite) |
| `auracle-session` at `db2103f`, 1 in 100 (round robin) | 21 | 10.3 min | 11 | 7 | 0 | 3 | 13 s to build, 37 s of tests (of a 46 s suite) |

Taste's survivors at `cf61f48`, by file: `model.rs` 53, `synthetic.rs` 21,
`standardize.rs` 8, `observe.rs` 5; at `47a0d4f`, after #231, 51, 21, 8 and
5; with #207's changes, none. Each was killed by a test or went with code
that couldn't matter, except one equivalent mutant in `model.rs`, which
`.cargo/mutants.toml` excludes with its reason (and so the run lists 601).
A caught mutant costs little: nextest stops at the first failing test
(`--max-fail=1:immediate`), so at `db2103f` taste's took 1.1 s of their
4.7 s suite and session's 16 s of 46. A survivor runs every test (taste's
6.3 s, session's 86 s), so the cost falls as survivors are killed: a
taste mutant's tests took 53% of the suite's time at `db2103f`, 23% at
`cf61f48`, with half as many survivors, and 3% with none. Each crate's
fast tier alone, on the same machine under like load, took: taste 9 s,
grammar 1 s, features 38 s, wasm 40 s, session 64 s;
rebuilding a crate's tests after a change, 3 to 11 s. Two of taste's
mutants timed out at `db2103f` (`synthetic.rs:54` and `:55`, in
`SyntheticUser::stars`), at the 20 s floor over a 4.7 s suite; why is not
known. At `cf61f48`, with #198's tests and a 24 s limit, both finished in
4 s and survived; #207's tests catch both.

**On a runner**, estimated, not yet measured. CI's Test job, before
Coverage took its place (ADR-023), spent about eleven minutes of a runner's
time on the fast tier (two runners, five and a half each), which this Mac
ran in about a minute and a half unloaded: about eight times slower. A
build is taken to be about four times slower. A mutant then costs about
15 s in taste, 25 s in grammar, two minutes in features and wasm, and three
to four in session; over the workspace's 8,307 mutants at `0f7a85d`, about
235 to 265 runner-hours. Four runners for six hours a week are 24, hence
the parts. `PLAN`'s counts are sized from these estimates to keep each shard
near four and a half hours, under its cap of five and a half (session's
2,001 mutants in 26 shards are 77 each: four and a half hours at three and
a half minutes a mutant, five at four). A weekly shard that stops at its
cap is a measurement that says its crate needs more.

## Flakes

The gate runs every test once, with no retries, in CI as locally. A test
that passes only sometimes is a finding about the app or the test, and a
retry would hide it while charging every run its timeouts (a browser spec's
waits run to two minutes). That holds for correctness: a race the app loses,
a state it never reaches. It does not hold for speed. A slow runner may make
a test slower, never wrong
([ADR-022](../decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md)):
how long something took is a budget, recorded on the gate and judged apart
from it ([Rules](#rules)).

- **Before a push** the spec files a branch adds or edits run three times
  each on the builder's machine, and the rest of the specs it reaches once
  (`make browser-changed REPEAT=3`, the `ship` skill), so a new spec that
  fails often shows there, before CI runs it once. The nightly hunt finds
  the rarer ones, and the flakes in specs the branch didn't write.
- **The flake hunt** (`flake-hunt.yml`) runs nightly: the fast tier's
  browser tests three times each, against main, where nothing changed but
  the machine. The specs on the fixture that name no seed of their own boot
  unseeded there (`AURACLE_SEED=random`); on the gate they boot seeded
  (`tests/web/fixtures.js` `SEED`, the same pool and sides every run;
  PERFORM's specs `PERFORM_SEED`, whose first offer is a typical one), so a
  spec that only holds for one pool shows up here. A spec that names its own
  `random:` seed keeps it in both. Each test that fails gets its own issue,
  `Flaky: <file> '<test title>'`, or a comment on the one open for it
  (`tests/web/flakes.mjs` finds it: the issue the test's annotation names,
  or an open issue under that title, cut short with … as a hand-written one
  may be). The comment names the test, how many of its three runs failed,
  what the first line of each failure said and the machine it failed on (the
  fixture's `runner` annotation), and the run, whose summary links one report
  with the traces. Every test there passed the gate on that commit, so one
  that failed all three runs is filed the same way: the hunt's seed differs
  from the gate's. What no one test accounts for (the engine's build, a
  runner cut short or lost, an error outside any test, or more than five
  tests failing in one night) files *Flake hunt failing on main*, beside
  the flakes the other runners found. A runner lost leaves no report, so
  the report job lists the tests the hunt was dealt and counts any that no
  runner reported.
- **Fix it.** Most flakes here have been a wait on a time rather than a
  state, an exact count of something a slow machine may do twice, or a
  speed bound asserted where a budget belongs ([Rules](#rules)).
- **Or quarantine it** while it is fixed: add `@quarantine` to the test's
  tags (`{ tag: ["@quarantine"] }`, or beside `@slow`) and name its issue
  beside the tag, `annotation: { type: "issue", description: "#N" }`
  (`make spec-lint` fails a quarantined test that names none). It leaves the
  gate and runs in the *Slow suite*'s job for quarantined tests, so it is
  still run and still seen. A failure there is a comment on that issue (the
  test, its runs, the run), and the job stays green: only a failure no issue
  owns (a test cut short, an error outside the tests, a test whose issue is
  closed) turns the run red. So *Slow suite failing on main* means a new
  regression, or a quarantine left behind when its issue closed.
  Remove the tag and its annotation in the PR that fixes it.

## What each browser spec pins

| Spec | Pins |
| --- | --- |
| `smoke.spec.js` | Clean boot, worklet registered, engine playable; the binary exports the walk surface, the `belief` call and the face calls `worker.js` calls |
| `session_seed.spec.js` | `?seed=N`: a fresh session with the same seed fills the same pool under the same names (each boot a browser context of its own), and another seed another |
| `boot_agrees.spec.js` | The built wasm's `boot_probe` (the shipped seed's first 400 trees, a small pool and its first duels) equals what native `shipped::boot_probe` pins in `boot_probe.json`; opens no page, about 3 s under Node |
| `fixture_tap.spec.js` | The fixture's tap (`fixtures.js`), on an echo worker with no app booted: a hold armed with `from` begins at the request it names and is spent once it has; `app.fail` answers a request as the worker answers one it could not run (an `engine_error` naming it, injected), the request still in `sent` and never at the engine, once or for every match, fatal or not; a speed budget is the test's annotation, and one over its limit fails the test only under `AURACLE_PERF=1`; on a worker that answers as `worker.js` does, a request's last reply (`app.replyTo`) is the one carrying its number without `more`, not the first of its type nor the engine's own news, `app.answered` waits while a request it covers has none and names it when it gives up, by type or lane, never for a request the worker never answers or one main did not number, and a reply `app.answer` or `app.fail` gives for a request carries its number; `app.visit` is a new load of the seeded address with a level's hash, even when only the hash changed; a page error in a context `newContext` made fails the test, and the context has the project's `use` |
| `failure_flows.spec.js` | Bad save, engine error, refused vote (and no ratings posted for it), profile import are contained |
| `first_run.spec.js` | The warm start keeps all 18 preferences; PERFORM's first steps tick off in the guide pill |
| `warm_start.spec.js` | The warm start run again from ⋯ deals nine cards with none picked, one pick reads *2 more*, three reach *teach it*, and *teach it* sends those three and teaches 18 more picks |
| `guide_pill.spec.js` | The guide pill (Plan-008 C1) shows one step at a time, bottom left of the stage under PERFORM's well and on PERFORM only, ticks each off as it happens (a note, a turn, an offer), says what the loop was and goes; × stops it across a reload (`auracle-guide`); the first steps' old ticks (`auracle-perform-steps`) carry over and the old key goes |
| `perform_layout.spec.js` | PERFORM as the specimen's well and panel at 1000, 1280 and 1440 px: the sound left of what you turn, the pad row WANDER · OFFER · PEEK · TAKE · PASS above the keybed with nothing cut; XY is a mode of the well (the button or Esc puts the face back, focus to the button) and How it works the other; Freeze is a tap or Enter on Wander, said on Wander; the moved bar shows only when the sound has left home, without moving the name, and BACK and KEEP settle it; Blend shows only while B holds an offer, and PASS passes without growing another, recorded as Next's pass after its window, its UNDO bringing B back (`@slow`) |
| `perform_touch.spec.js` | On a tablet (a coarse pointer and touch) no pad shows a printed key, and every PERFORM function the layout moved is a tap away: Wander's freeze, XY in the well and its field, the moved bar's KEEP, HOW IT WORKS, ARRANGE's velocity row, stage mode's tap and ×; EVOLVE's ⇄ circuit and what each generation did |
| `pad_keys.spec.js` | ADR-018's keys: N offers and with B full passes and offers again, B held is PEEK held, ⇧↵ takes (`@slow`); ↵ keeps only with no control focused, ⇧⌫ goes back, and at home each says there is nothing to do; the keys yield to a text field and a modal, the note keys still play, and N in EVOLVE deals another pair |
| `evolve_cards.spec.js` | EVOLVE's cards (Plan-008 C1): each sound's face large in its card's well, ⇄ circuit swapping it for the patch and back, ↓ patch opening it in PATCH; the relabelled buttons keep their ids; the small map goes to TASTE; EVOLVE POOL is dashed and pressable before the first fit; what each generation did opens over the foot of the cards and Esc folds it |
| `bank_row.spec.js` | A bank row's controls appear on approach and work; m in the list saves the sound under the cursor once a press, however long it is held; a preset row's IN POOL and its ▶ both read whole at 1000 and 1440 px at rest, under the pointer, with the focus on the ▶, while it plays and under the keyboard's cursor, its name at every preset name's x |
| `evolve_feedback.spec.js` | TAUGHT counts at once, pick toasts replace, the dealing rule (the default's line through picks and a skip, a choosing rule's, and a check's mark under it; each rule's words, and a check under the default read as the default, are `apps/web/tests/words.test.mjs`'s), the sixth-pick redraw, every pick's reply carrying ratings that move per pick (ten seeds, ten may-replace), bank ▶ |
| `patch_editing.spec.js` | The bench lane: edits in order, no lost edit, knobs survive redraws, receipts; KEEP AS NEW's blind card (Esc cancels), the one-shot *pick the edit*, a commit retiring the edits' receipts |
| `taste_marks.spec.js` | A guess drawn hollow with a ? in LEARNING's weights and the module rail; the module rail's spec card says a settled lean in sentences; TASTE's and LEARNING's early states count what is left |
| `taste_learning.spec.js` | A pick draws an arrow from the sound passed to the sound picked, from the engine's reply (and on arrival for a pick made elsewhere), held and then gone under reduced motion; every halo moves to the ratings a pick posts, and a refit settles them all at once; LEARNING's weights, forecasts and math are the worker's numbers (`model_facts`, `forecasts`); copy as JSON gives them back; a mark's slot keeps its label's x; a style renamed on its chip, its ▶ pressed straight after still plays; the track replays the posted history, after a reload too; SOUND and TASTE; pointing at a weight, or Tab to it, names its feature on the small map's legend and in what the map says aloud, and leaving puts the arrow's legend back (which feature's z shades the dots, and how, is `apps/web/tests/taste-geom.test.mjs`'s; no spec reads that shading); the bars equal the styles posted after each pick; REPLAY steps through θ as posted, in order; a REPLAY step across a refit is the refit's, with no pick's ghost or light |
| `taste_profile.spec.js` | Reset asks with this session's counts (its sentence for any counts is `apps/web/tests/words.test.mjs`'s), downloads first and keeps saved patches; Save says what it downloaded |
| `narrow_gate.spec.js` | The narrow-window notice at any pointer under 1000 px, not over the handheld gate or "look around anyway" |
| `keys_are_not_notes.spec.js` | A letter or digit a list, the rack or a dialog handles is not also a note or a rating |
| `evolve_truth.spec.js` | ⌘Z outside PATCH changes nothing unseen, pressed once or twice, and a second press's refusal takes the first's place (what waits behind it, the toast's +N, does not grow; the lane's rule is `apps/web/tests/toasts.test.mjs`'s); the sixth pick is undoable; "it just learned" follows `fitted`; with no pair waiting, a skip or a slow deal is inert (the picks, ▶, ↻ and the cards' corners) and says why; a deal that comes back empty leaves them off and the cards saying *Nothing to pair*, and a cut taken back deals again; a cut patch is not dealt (every deal asked for after the cut excludes it and no pair put up after it holds it; the answers a cut keeps from going up wherever they land, a deal asked for while the cut was taken back or the fourth try of a waiting table, are `apps/web/tests/deal.test.mjs`'s); opens are quiet unless slow (the app's own `patch-opened` mark says how long each waited), and a slow one is said in a sentence; tab click then → picks; keys a list uses are not notes; with no farm (`?farm=0`) a deal during a generation names the seed it waits on |
| `evolve_ahead.spec.js` | A pick or ↻ puts the pair dealt ahead up at once, sounds and all (in the click's own task, with no deal for the table asked for and no render for its ▶; the milliseconds a budget); a taken-back pick restores its pair and keeps the pair that replaced it as the next, or, when the table was still waiting on a deal, that deal; #211's probe (seed 20260928, the pool filled; pick, ⌘Z, pick, pick) shows the first pair dealt behind Q after Q whether that deal landed before ⌘Z, was still out at ⌘Z (its answer held) or was not asked for before ⌘Z (Q's render replies held), as `apps/web/tests/deal.test.mjs` holds of every request and pair in each order; a patch cut while its pair waits ahead is never put up; pairs go up in the order they were dealt when a pick lands while the next deal is out |
| `evolve_breeds_beside_you.spec.js` | EVOLVE POOL completes on the farm with children landing in job order at the top of the bank; a pick mid-generation is dealt its next pair while the generation runs (each deal's time a 1 s budget); GENERATIONS and the next-step chip count a generation once a child has landed, not on a pick's status; PERFORM measures and a pressed Offer starts during a generation; stop ends with what's bred, retiring only at the finish; ⚡ leaves the engine free and its stop drops it; ⚡ and EVOLVE POOL take turns, each disabled with its reason while the other runs; the E and the job slot agree |
| `evolve_from_new.spec.js` | A ⚡ child joins the bank's New group (*new · generation N*, tagged NEW) as a generation's children do, the next-step chip counts it, and its toast names the sound; a ⚡ that bred nothing never says "its parent" |
| `bank_kept.spec.js` | A sound kept as new that rates lowest of everything a preset could replace (from the engine's own ratings, its original saved) stays when a preset opens on a full pool; the one replaced in its place is what the toast names; pointing at EVOLVE POOL never marks it *may be replaced*. Fails against an engine without the protection (`Candidate::unjudged`) |
| `bank_lineage.spec.js` | Pointing at EVOLVE POOL marks the seeds and what may be replaced from the engine's `ratings`, and during a generation its own seeds (posted with its progress) and `retiring` as *will be replaced*; no mark (the unheard dot, NEW, seed, may be replaced) moves or narrows a row's name, measured; the unheard dot survives a reload and clears when heard; Compare shows a child beside its seed, the diff and both ratings, and plays both while both exist; a refused child buds beside its seed and is gone, and EVOLVE POOL names each walk's outcome; a generation's children land in New with their seed and what changed, each budding from its seed's row (none with motion reduced), and Replaced and the end's toast name only what its end replaced (the generation's `refine` stalled and its replies injected, so every branch runs); Compare lists every change and scrolls, and opens with c from the bank; while ⚡ walks, its seed and the sound its child would replace are marked, and that is what it replaces (which of the engine's lists each mark is read from, while ⚡ walks or a generation runs or at rest, is `apps/web/tests/marks.test.mjs`'s); a ⚡ child that replaced nothing leaves Replaced as it was; the name's place and each mark word's fit are measured at 1440 and 1080 px; GENERATIONS counts a generation from its first child with no pick since it opened; a sound saved mid-run loses *will be replaced* and the one that will go instead gains it |
| `faces.spec.js` | A face lands on every row, EVOLVE card, PATCH's header and teach strip, PERFORM's sound in hand and its offer (the offer's its own), and the warm start's cards; a cut redraws the bank's faces against the bank as it is now; a row's name has the same x and width with and without its face, uncut, on a desktop and a phone; the sound's card downloads at 1200 × 630 with its face, its name and its patch inside (PNG and SVG); after a reload every row draws the same face |
| `faces_presets.spec.js` | A preset row's face is the worker's own face for that preset (the key its slot is drawn from, the bytes main was handed); scrolling PRESETS asks for the rows that come into view, none with a face before, and draws each; a preset opened while preset faces wait is answered with at most the face render already running ahead of each of its two requests (a face counted as it reaches main, so the open's window allows one more still on its way when the open was sent), and the faces were still waiting when it was answered and go on landing after it (an order through the tap) |
| `budgets.spec.js` | The response-time budget: the timing marks exist; a preset's controls, and a warm-start pick's, are live in the task PERFORM names it, wired from the shipped file (the app's `perform-wired` mark); the engine is asked to measure the warm start's nine cards as they are dealt, the picks first in the order made after each pick, and none once *teach it* closes the card; a pick puts the next pair up in its click's own task with no deal for the table asked for, and the duel's ▶ sounds in its own with no render asked for. The seconds are budgets, recorded and judged nightly: ≤ 1 s from the click or *teach it*, 0.3 s, 0.15 s |
| `perform_controls.spec.js` | Half-closed controls stop at centre, XY axes (in the well's XY mode), the status line |
| `perform_open_early.spec.js` | With the engine's messages held: a Keep while a patch is still opening is refused and says why; the preset clicked last is the one opened; an open that cannot complete puts the voices back on the rack |
| `perform_instant.spec.js` | With the shipped file blocked, the player's cache: a revisit wired from it, after a reload too (the app's `perform-wired` mark says *cached*, not measured again; 0.5 s and 1.5 s are budgets), and a preset opened before wired from the click with every message to the engine held; a preset opened, or a patch measured, just before a reload is remembered after it (both caches are written as the page is left); a spare offer lands at once (B holds it by the end of the press's own task, and the press asks the engine for none); a kept wiring stamped by a build before the render namespace (a new quiver) plays at once, is re-measured, and is replaced |
| `perform_next.spec.js` | A spare grows while B holds an offer, so NEXT is as fast as Offer (B holds it by the end of the press's own task, and the press asks the engine for none); the pad reads NEXT · passes on B; a heard pass has UNDO (B back, nothing recorded) and counts after its window; an unheard pass says it was not counted |
| `perform_wander.spec.js` | Wander's first move ~1.5 s after it is let go in a new zone; its own drag is not a touch; zone ticks; the *ideas* zone; its caption carries its state and counts down; the status line keeps to the patch; its tooltip and how it works say a tap freezes it |
| `perform_recentre.spec.js` | A re-centre glides home with a fading ghost; a background re-check with the same knobs leaves a turned control where it is; a MIDI pot on Blend is let go when Blend comes home and takes it again from home |
| `perform_teaches.spec.js` | An offer heard and answered is a pick; unheard, it is not |
| `perform_offer_latency.spec.js` | With the page's own `later` work done (the shipped wiring's re-check, the page's spare) and then a very long spare offer growing, a Keep on the panel says so within max(4 s, six measured steps), the spare still growing before and after it (the page's CPU is throttled 4x, which need not reach the engine worker, so the bound rests on the measured step). A pick and a `retire` during a spare, and an Offer while the guess waits for its crew, are the worker's (`tests/worker/`) |
| `perform_palette.spec.js` | The palette places, hides and orders up to eight controls, and the panel comes back after a reload; a placed control is measured with the panel's set (asked in palette order), keyed by that set, and says *listening…* until it is; each knob wears its own control's wiring and an aimed offer names its control by palette index on a panel in another order; HOW IT WORKS lists every placed control and opens on the one last touched; a row's mark never moves its name |
| `perform_offer_moments.spec.js` | B grows from the sound's face in the well, a taken B fills and goes into the face, a passed B folds back into it (each motion's keyframes against the page); an offer taken unheard becomes the sound and records no pick (no `perform_record`), and taken heard records one; a heard Take kept as new inside its eight-second window is recorded after the keep with an `asOf` below the kept id, so it does not judge the kept sound |
| `perform_stage.spec.js` | ⇧F enters stage mode and ⇧F or Esc leaves; Space plays in it and it draws only while sound plays; F alone is still a note; ⇧F is stage mode in PERFORM only and the accented F in PATCH; Tab stays inside it and focus comes back on leave; a refusal said in it is in sight |
| `explain.spec.js` | Each control on the panel opens its figure (by ?, by its chip, from the switcher and the arrow keys), asked of the engine for that control on the sound in hand, and a view change puts it away; every one of the palette's eighteen opens its figure (`@slow`); a control asked about before it is measured answers once it is, a search control too; a turn with an answer open asks at most twice; Space plays with an answer open and in the lesson, after a click on their buttons too, and NEXT takes Enter only; the lesson says why a render failed (injected), draws and plays nothing for it, says when the filter goes after a sound with no room, and asks nothing more after the sound itself fails; ? is the key map's once the pointer has left a control a mouse turned, and never opens over an answer; a long press on a touch screen opens the answer and a moving finger does not (CDP touch); with a bank of faces, BRIGHT's figure and the lesson draw the sound's face from the portrait's own; with no answer or lesson open, a pressed Offer grows with no explain request sent, and an answer put away cancels its waiting request (answered as `cancelled`); `AURACLE_CPU_THROTTLE=4` runs them at a quarter speed, the engine worker too (the fixture's boot); a figure's sentence is built from the worker's reply (BRIGHT's center, made and turned) and follows its control when turned; the lesson on filters renders the sound in hand, its cutoff's readout is the reply's and the filtered top sits lower, and another sound gives another lesson; under reduced motion a figure is drawn whole and holds, and with motion MOTION's runs; asking moves no control's or bank row's label |
| `perform_aimed.spec.js` | A search control's offer is asked for aimed (control and way), B counts while it grows and then says how far it moved, in amber; the Offer pad's offer is not aimed |
| `perform_lean.spec.js` | PERFORM under the model view (#140): before the first fit the view asks for each control's lean (`perform_lean`, the panel's set, no overrides) and draws none; after the warm start's fit each control carries its lean, a settled one solid toward the end it names (*it leans bright*, the dot on that side) and a guess dashed with a "?" (pinned with `app.amend`), the engine's own leans drawn as their intervals say; nothing is asked again while nothing changes, a rating asks again, and at rest the arcs and words go and the captions come back; a taste file with nothing taught in it, opened over PERFORM, asks again and the engine's `null` takes every lean away, and the view toggled brings none back and asks nothing; a capture's new audition clip asks again for the lean of a sound in hand that listens (the microphone stubbed, `audio_in_stub.js`) |
| `perform_circuit.spec.js` | A knob turned in PERFORM is drawn performed in PATCH |
| `perform_truth.spec.js` | Half-closed rings on the open side and their captions; *listening…* is never the search look and never grafts; first steps name a control that turns; choosing an XY axis gives the keys back; search controls spring back; Blend home after a pass; a drift's re-check is background; a stalled shipped-wirings fetch still lets a preset be measured; a re-check or a first measurement the engine never answers (an injected `engine_error` naming its `req`, the engine slowed fourfold so it is still out) is let go, the status saying it couldn't re-check or measure the patch instead of *re-checking* or *listening…*, and so is a measurement asked for before the engine has booted (its `init` stalled by the tap, a patch handed to PERFORM as `tree_json`, the worker answering `not_ready` with the request's `req`); after a crash (the engine poisoned, every request answered with a fatal `engine_error`) no spare is asked for by itself and a pressed Offer is not sent, B saying the engine crashed; an offer whose walk crashed the engine says so in B even when its own empty reply came before the crash (a worker from before the worker answered a trap with the crash alone, which `apps/web/tests/worker-perform-replies.test.mjs` pins); a module the engine fails to add (an injected non-fatal `engine_error` for `perform_graft`) is said to have failed and grows no offer in its place |
| `patch_truth.spec.js` | An unplugged socket goes quiet and reads EMPTY; a knob turned in PATCH keeps its value with no ghost, and PERFORM plays from it |
| `patch_audible.spec.js` | Measured at the output: a VCO's wave cycled in PATCH has each wave's harmonics under a held note and on ▶ and Space; a selector changed under a held note keeps its level while the engine renders it (nothing reaches the voices before the reply) and plays at its measured makeup once it lands; a knob whose check finds a runaway is muted, as the alarm says, until a check passes; a selector whose check fails is not applied and the alarm says so, and a knob turned after it is not muted for it; an edit's reply leaves alone the makeup of a preset opened from memory while the edit rendered; an undo and a redo of a selector reach the voices at their measured makeup, so a held note's level holds while they render; a cutoff turned down lowers the centroid live and on ▶; ▶ or Space pressed while the edit is still at the engine plays the edit, not the sound before it; Space in PERFORM and EVOLVE plays the edited sound, waiting for an edit the same way, and the sound in hand in the menu bar says it waits from before the edit lands; that waiting ▶ is lit before the edit lands (100 ms after the press is a budget for each), and a second press, Space, another ▶ or leaving PATCH takes it back; Space with ▶ disabled says why and plays nothing |
| `audio_in.spec.js` | AUDIO IN, with the browser's inputs stubbed (tones per fake device, never a microphone): the browser is asked only when AUDIO IN is added, and says what for while it asks; a refusal keeps the module, silent, with ASK AGAIN; each device opens once and fans out to every module reading it (and the input menu reuses it); a tone in is heard at the output with no key down once MONITOR is on and not at all while it is off (a key held or not), monitoring is off after a reload and a sound that listens opens its input without a prompt; the first listen captures a clip the engine takes, NEW CLIP another; the captured clip is saved with the session, and after a reload AUDIO IN has it as the session's clip (the farm handed the phrase with it, after a capture or a restore, is the worker's, `tests/worker/farm.test.mjs`); an unplug silences the module and says so, a replug plays again; the browser's `default` is numbered as the input it stands for when only the list's "Default - X" names it; the square draws the input's live face while it plays and nothing, level included, once it is unplugged |
| `audio_in_takes.spec.js` | TRACK and CAPTURE, on the same stub (`audio_in_stub.js`): both in the module rail, and placing TRACK asks for an input; a tracked sound monitored plays from the input with one voice, and keys over it sound as voices of the tracked note (held, the output's RMS sits within −3 to +11 dB of the tracked voice's: four voices at one pitch sum by phase, so the 440 Hz bin can't carry a band) and stop with their keys (the level after they are let go is the tracked voice's alone); CAPTURE's RECORD puts a take of its input in the sound as an edit, the module says its length, and a key plays it; a STOP the worklet answers with no frames sends no take and says nothing was recorded (the worklet's own half, exactly, in `apps/web/tests/worklet-take.test.mjs`); moving to another sound while RECORD is lit stops it, and the take lands on neither sound, while a keep as new is the same sound and the take lands on it; a sound whose take couldn't be read is kept safe under *kept safe* and RECORD AGAIN brings it back into the pool, waiting for its input to open (held open by the stub) and recording that input while the bench reads another; a refused input says so and records nothing; the bank's cursor reaches a sound kept safe past the pool's last row, and Enter presses RECORD AGAIN; AUDIO IN's and CAPTURE's buttons are on the rack's keyboard walk (the arrows reach them after the knobs, a hidden one is passed by, Enter or Space presses them, Escape backs out to the plate, and the focus stays on RECORD through the redraw its take makes) |
| `patch_guess.spec.js` | The model's guess for the next module, read as the worker posts it: the top guess drawn at its socket with GUESS · ‹module›, its reason and forecast in the model's italic (and *it may not help* when its lower bound is under zero), the rail's mark beside its name without moving the name; a skip shows the next guess, not that family at that socket; adding it sends the guess with the edit; ⌘Z of an added guess counts as a skip; nothing before the warm start (`no_taste`), with no render crew raised for it; every candidate ranked on a crew; a skip made after KEEP AS NEW still holds when the kept sound is opened again; a new patch's skips are not the sound's it was started from; a guess added after its socket was filled is refused with the engine's reason; a guess asked while boot's crew is still filling the pool waits for it and is then ranked on a crew, every candidate |
| `patch_cables.spec.js` | Each audio cable's light and level mark follow the levels `cable_levels` posts, one per cable, keyed `from>to` as the rack draws them; modulation cables carry neither; never more than one probe at the engine; a knob drag asks for one probe after it settles, its marks hollow until then; every paint of a new structure before its levels arrive is unlit, with hollow marks; with two sounds opened right after arriving in PATCH, every probe and guess goes out with no open on its way and at least the quiet window (`ARRIVE_MS`, 1.2 s) after arriving and after the last open landed |
| `patch_motion.spec.js` | The rack's motion, read on every frame of it, from the frame its build lands to the first frame at rest: a sound opened over one it shares no module with fades up where it lands, with nothing of the last one left to fade out and its amp in its own place (the cable into it a curve on every frame); within one sound an insert still slides the amp from where it was, NEW PATCH fades out what it took as the amp slides along, and the two ways back, ⌘Z past NEW PATCH and BACK TO ‹name› (the sound on the bench opened again), each slide it back as the empty socket fades out; through every one of those slides the cable into the amp is the curve it rests in on every frame, though the insert, ⌘Z and BACK TO slide the amp past the module newly plugged into it; and a cable already on the rack is never a curve drawn backwards: switching a layout by hand to chain, with the amp put behind every module, the cable into it keeps its right-angle run below the plates while the amp is behind its source, and is a curve at rest; and what sits on a cable moves with it: through an insert and a switch from chain to compact each audio cable's level mark is on its cable's middle on every frame, and a modulation cable's words beside its middle, as they are under a module held mid-drag by hand |
| `patch_from_nothing.spec.js` | NEW PATCH leaves one empty socket and the amp, named *New patch* and counted in its caption; modules added from the rail; a processor deleted and put back with the toast's undo; a source deleted leaves its socket empty; CLEAR and its undo; BACK TO ‹name› reopens the sound, and NEW PATCH brings the new patch back; ⌘Z past its start ends it; Esc on a plate button (CAPTURE's RECORD) backs out to its plate and keeps the new patch |
| `patch_sheet.spec.js` | On a coarse pointer, a tapped module opens a sheet with a row for every knob the engine describes (a slider with − and + of at least 44 px, or the setting's choices); + edits the knob through the lane, a choice sets a named setting and the arrows move between choices, focus goes into the sheet and leaves it with ×, a tap on another module opens that one; an AUDIO IN in the patch is drawn with its three settings, and its sheet has them; a tap on a plate button (CAPTURE's RECORD) presses it and opens no sheet |
| `patch_model_view.spec.js` | PATCH's model view (Plan-008 C2b), with a pinned fit: nothing of it at rest; held ⌥ and a tapped MODEL show the belief line in place of the subtitle, a lean edge only on the settled family's plate, one worth chip per family (two VCOs, one chip, *shared by 2*, a guess dashed), the ranking's runners-up with their lower bounds, the patch's parts in the readout and a selected module's lean over it; letting go rebuilds no plate; no "lens" in what it shows (`@slow`); under the view a new patch's subtitle and sound A's in TEACH keep their states after the belief line, after a "·"; with the bank's largest style and the bench's apart, the leans, the worth chips and a module's note read the bench's (`@slow`) |
| `patch_facts.spec.js` | PATCH's four engine facts: the face without the selected module is the worker's face for the patch with it bypassed, and the only source says *silent without it*; What goes here? sends `at` from the ⋯ and from Q, draws the ghost at that place with its place words, Esc returns to the output's guess, the line's ✕ sits outside its live region, and Enter takes exactly the ranked edit (`@slow`); a ⚡ child shows *from Reese · N changes*, its ticked modules and seed pointers as its `LineageEvent` says, gone after an edit and back after undo to as opened (`@slow`); the readout names the PERFORM controls PERFORM's measurement says turn a knob, and a module's |
| `patch_keys.spec.js` | PATCH's keys (Plan-008 C2a): ←/→ walk the modules in signal order and Home/End reach the first and the amp, from a module or with nothing in focus; ↓ goes into a filter's LFO and ↑ back out; Enter goes into a module's knobs, ↑/↓ turn one, the arrows stay inside the module, Esc goes back to it and again leaves it, and ⇧Home fits what ⌘= zoomed into; F2 opens the structure menu, and Esc closes it with the focus back on the module, still selected, until the next press; Delete on a two-input module asks which input survives and deletes nothing yet; Esc walks out of a new patch one thing a press (the module, the catalog, then back to the sound), and the scope panel or KEYS ⋯ open over it goes first, that press sending no `edit_begin`; a module in hand takes the arrows to choose a socket and Enter places it; the keys yield to the catalog's search, and the note keys still play on a module; Home and End stay VOL's slider's, and under KEEP AS NEW's comparison Home and Delete reach nothing behind it; the layout menu takes the first Esc, the selection the next and the catalog the last; the selection follows the module when an insert before it moves its key |
| `space_after_a_click.spec.js` | A click leaves no focus on the wave or filter-mode chip, and Space then plays and leaves the chip alone (the second Space stops it: the app stops the phrase's source, and the output goes quiet); a chip reached with the keyboard cycles on Space and Enter and back with Shift, its name carrying its value and each cycle read out; in PERFORM, Space plays after a drag on a control, a click on the XY pad, and a tap on Wander (which stays frozen); the ⋯ menu's file items open their dialog on Enter and Space |
| `midi_announced.spec.js` | A MIDI knob that claims or learns a control is announced in a sentence (*CC 74 now moves Bright, the first free control.*), the later replacing the earlier |
| `keys_for_the_platform.spec.js` | The ? card, the booth menu and the minimap's tooltip print ⌘ and ⇧ on an Apple platform and Ctrl and Shift elsewhere |
| `responsive.spec.js` | Warm-start ▶; teach it opens PERFORM named at once; Take keeps its controls, and once the engine answers the taken offer's measurement (waited for within `offerBudget`) the status stops saying *re-checking* (`@slow`: up to minutes on CI with a heavy offer); a Take's measurement, kept from the engine so it is still out, is retired to the background when PERFORM goes to PATCH and promoted when it comes back (`@slow`, for the offer). The player answered first while PERFORM measures, and what `retire` and `promote` do, are the worker's (`tests/worker/`) |
| `booth.spec.js` | Attract plays in PERFORM, hands over on a key, and teaches nothing |
| `film_chip.spec.js` | The menu bar's film chip |
| `model_view_esc.spec.js` | Esc closes the nearest thing first and a tapped model view last, outside PATCH too: PERFORM's XY and How it works, the ? card, the scope and picture panels (pressed from their ×, not a drop-down, which keeps the view up by itself, and the focus back on ⋯) and a sound's card on TASTE's map each take one press and leave the view up, and the press after ends it; KEYS ⋯ or a bank row's ★ over XY goes first and XY stays; either panel over PATCH's selected module goes first and the module stays selected for the next press; XY goes from an axis's drop-down too |
| `shell_levels.spec.js` | The levels (Plan-008, ADR-017): the app opens at PERFORM; the rail's stops, ⌥↑/⌥↓, ⌥←/⌥→ and ⌥1–5 and the arrows on a focused stop move between them, one section shown, its stop alone `aria-current`, `#where` naming it; a text field and a modal keep ⌥ and the arrows, and ⌥ alone is taken; a stop's name shows on hover; Space plays the sound in hand at every level and the menu bar's ▶ lights; a reload, a level's hash and a saved `"play"` open the right level; KEYS ⋯ reaches every control that left the bar, is lit while one plays differently, and folds on Esc or a press outside the dock; the stops cover no control at any level at 1000, 1080 and 1440 px |
| `type_scale.spec.js` | The type scale in the browser: no text in the page under 11 px on any view or the ? card, pseudo-elements and the minimap's bookmark numbers included (the rack's SVG and a lone glyph aside); no canvas font under 12 px on the scopes and on LEARNING's forecast strip, whose labels keep their descenders inside it; the menu bar one row, as tall as `--menubar-h`, at 1440, 1000, 860 and 390 px; and `--d-press`, `--d-state` and `--d-move` all 0 under reduced motion |
| `text_fits.spec.js` | Text the type scale enlarged still fits: the warm start's cards inside a 390 and a 360 px phone's screen, and their words inside the cards; at 1000 and 1280 px every PERFORM control caption state whole (no ellipsis, no clamp, nothing past its box), with the knob row one height whatever the captions say |

## Rules

- **Optimized profile for Rust tests**
  ([ADR-005](../decisions/005-tests-run-optimized.md)).
- **Browser jobs take a ticket (tests two at a time), own port for a worktree**
  ([ADR-010](../decisions/010-tests-share-the-browser-recordings-do-not.md)).
- **Gate tests over mocks.** Extend the gate that covers a behaviour.
- **Logic is unit-tested; a browser spec proves the wiring.** New logic lands
  in a pure module under `apps/web/` with a `node:test` in `apps/web/tests/`,
  which `make web-check` runs in milliseconds. A browser spec proves that the
  module is wired in and what a player sees and hears, not its arithmetic: a
  boot costs seconds, here and on a CI runner (a median of 4 to 5 s there,
  about 28% of the fast tier's test time). What the engine worker answers,
  and in what order, is a worker-protocol test (`tests/worker/`,
  [The levels](#the-levels)), not a spec that boots the app to read
  `app.reply`.
- **One fixture layer for the browser specs** (`tests/web/fixtures.js`):
  page errors fail every test by themselves; `app` boots seeded (`?seed=`)
  through one tap on the engine worker, waits on the engine through named
  bounds that add their time to the test's timeout (`app.engine`,
  `app.reply`, `ENGINE_MS`; 450 s in all at most, `ENGINE_CAP_MS`), finds a
  request's own reply by the number it carries back (`app.replyTo`,
  `app.answered`; `web-runtime.md` § The worker's replies), and holds the
  engine's own replies while an injected one stands (`app.hold`). UI state waits the config's 10 s; a test
  has 90 s of its own; "nothing happens" is `app.quiet()` (`QUIET_MS`,
  1.5 s), the one fixed wait. `tests/web/AGENTS.md` § Writing a spec.
- **A green browser test against a stale `pkg/` proves nothing** about Rust
  changes. Check the session-start hook's warning, or `make wasm` first.
- **Time in a test is one of three kinds**
  ([ADR-022](../decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md)):
  an engine fact is a wait for the reply that answers the request; a promise
  about the app's own timeline is asserted on its clock (the state in the
  gesture's own task, order through the tap, the app's marks, `page.clock`,
  `AudioContext` time); a measurement of the machine's speed is a budget
  (`tests/web/fixtures.js` `budget`, `app.budget`). A budget is recorded as
  the test's annotation (`budget: <name> <ms> ms of <limit> ms`) and never
  fails the gate; with `AURACLE_PERF=1` it is judged, as the nightly *Speed
  budgets* job does. A wait that remains keeps 1.5 s or more of slack, and a
  spec accepts the app being faster than when it was written.
- **A wait on PERFORM's engine growth uses `offerBudget`**
  (`tests/web/perform_budget.js`): an offer, a drift, or work queued ahead of
  one is renders, about a quarter of a second each on a 16-core M3 Max and 1.5 to
  2 s on a CI runner. The budget is the longer of a floor (240 s on CI, 90 s
  elsewhere) and 120 steps measured on the machine at the start of the test,
  and it grows the test's timeout by one budget per wait. What must not wait
  for an offer (a pick, a Keep, NEXT) keeps its own bound from a measured step.
  The fixture's `app.boot` also applies `AURACLE_CPU_THROTTLE` to the page
  (CDP) and to the engine worker's wasm calls (`perform_budget.js`
  `SLOW_ENGINE`), which CDP's throttling does not reach: with
  `AURACLE_CPU_THROTTLE=4` a step measures 1.8 to 2.4 s on a 16-core M3 Max,
  about a CI runner's, against 0.3 s without it.

## Budgets

How long each tier may take, so a slow run is seen rather than felt. Each
budget is a figure plus a fifth, rounded up to a whole minute. Where the
shape of a run is what it was before the two lanes, the figure is the p90
that `scripts/ci_stats.py` measured on green runs since #177's wave 0 merged
(2026-10-06 02:31 to 09:00 UTC, every one of them finished). The two lanes'
answers have no runs to measure yet, so their figure is the design's
([*How long*](#ci-tiers) above), until the nightly *CI health* run measures
them.

| Tier | Budget | From | Of |
| --- | --- | --- | --- |
| The fast lane's `CI` answer, a docs or other PR: the run created to `CI` done | 6 min | the design: about 5 | not measured yet |
| The fast lane's `CI` answer, a web PR (the app or its specs) | 12 min | the design: up to about 10 | not measured yet |
| The fast lane's `CI` answer, a Rust PR (with the Makefile, setup.sh) | 12 min | the design: up to about 10 | not measured yet |
| The fast lane's `CI` answer, a CI PR (a workflow or an action) | 15 min | the design: about 12 | not measured yet |
| The queue's run: created to `Full gate` done | 15 min | the design: about 12 | not measured yet |
| The Rust fast tier: each `Coverage (k/3)` runner | 6 min | measured: 3.8 / 4.3 / 4.5 min | 30 jobs |
| Coverage: *Coverage build*'s start to *Coverage*'s end | 20 min | measured: 13.2 / 16.5 / 16.9 min | 10 runs |
| The browser fast tier, a shard: each `Browser (k/12)` runner | 11 min | measured: 7.6 / 8.4 / 9.8 min | 228 shards |
| The browser fast tier in total: the first shard's start to the last one's end | 19 min | measured: 12.4 / 15.7 / 19.0 min | 19 runs |
| The browser fast tier in total: runner-minutes a run | 108 | measured: 86.4 / 89.9 / 94.0 | 19 runs |
| The *Slow suite*: a green run, created to its last job done | 67 min | measured: 33.2 / 55.2 / 77.8 min | 7 runs |
| The nightly *Flake hunt*: created to its last job done | 72 min | the design: three rounds of about 20 min | not run yet |

Measured figures are median / p90 / max. The kinds of PR are ci.yml's
lanes: a CI PR changes a workflow or an action, and its fast lane is the
full gate; a Rust PR changes what builds (a crate, the Cargo files, the
toolchain, the Makefile, the coverage gate's scripts, setup.sh); a web PR
the app or its specs; and a docs or other PR anything else (the docs, the
site, `.claude/`, another script, a changelog entry). The design's figures
leave out the wait for a runner: under wave 0, when every PR's own run was
the full gate, a Rust, web or CI PR's took a median of 19.9 minutes (p90
23.3, 19 runs) against a plan of about twelve, and its longest wait for a
required job's runner was a median of 6.6 minutes. The *Flake hunt*'s
twelve shards run three times over, four at a time: three rounds.

A budget is where a run starts to be slow, not the goal: #177's targets are a
PR's `CI` answer in a median of 11 minutes (p90 13) and a required job
waiting a median of 30 s for a runner. The budgets come down as that work
lands, each from a new measurement.

**Reading it.** `python3 scripts/ci_stats.py` measures the last 7 days
(`--since` and `--until` take dates): `CI`'s wall time, the required jobs'
runner waits, red runs and the job that failed, and runs per PR, by kind of
PR for the fast lane, and the same for the queue's runs (*Queue batch*);
open to merge, PRs merged a day, open to the first red, the time from
entering Mergify's queue to the merge (Mergify's own figure, from its status
comment on a PR it merged; n/a for a PR merged by hand) and how many times
each PR entered, and how long `main` stayed red; each browser shard's time and their spread; and each
job's time on green runs. `--format json` keeps a run, and `--compare` sets
each headline against one: the week before wave 0 is
[`docs/notes/ci-baseline-2026-10-05.json`](../notes/ci-baseline-2026-10-05.json).
The nightly *CI health* workflow (`ci-health.yml`, after the *Flake hunt*)
writes the last 7 days against it to its run's summary; a run that stops at
the API's rate limit writes what it read, says so, and goes red.
