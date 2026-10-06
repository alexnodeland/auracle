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

| Gate | Command | Proves | Run when |
| --- | --- | --- | --- |
| Format | `make fmt-check` | rustfmt is clean | Any Rust (a hook formats on edit) |
| Lint | `make lint` | clippy with `-D warnings` | Any Rust |
| JS syntax | `make js-check` | Every app script parses, including the worklet literal | Any JS (a hook checks on edit) |
| Web units | `make web-check` | Syntax, plus the pure modules' unit tests (`apps/web/tests/`), plus the spec lint below | Any JS |
| Spec lint | `make spec-lint` (in `make web-check`; needs `npm ci` in `tests/web`) | ESLint over `tests/web` (`eslint.config.mjs`): the Playwright plugin's recommended rules (no fixed wait, no missing `await`, web-first assertions, no assertion in a branch) and the house rules (the fixture, not `@playwright/test`; no `pageerror` listener of a spec's own; no clock on the runner; no `expect(await …)` straight after an action; a duration bound only as a budget, [ADR-022](../decisions/022-a-slow-runner-makes-a-test-slower-never-wrong.md); `window.__aur` only through named helpers). No file's count of a rule moves from `tests/web/eslint-suppressions.json` unrecorded: a rise fails, a fall is recorded with `--prune-suppressions`; against the merge base with `BASE` the file itself gains nothing (no count up, no new entry, no key for a file that is gone: `suppressions.mjs`); the lint's own tests pass (`eslint.test.mjs`) ([`tests/web/AGENTS.md` § The lint](../../tests/web/AGENTS.md#the-lint)) | Any change in `tests/web` (the after-edit hook lints a file there as it is edited) |
| Tokens | `python3 www/brand/tokens.py --check` (in `make dev-check`) | Every generated block is current; no color is written outside the tokens; no token is redefined after its block; no file's count of literal font sizes, spacings, radii and durations (in its CSS, its scripts' styles, canvas fonts and animations, and the custom properties those use) has moved from `www/brand/sizes-baseline.json` (`www/brand/README.md` § The tokens) | Any stylesheet, a page's styles, a script that draws or styles |
| Voice | `python3 www/checkwords.py` (in `make dev-check`) | No file's count of banned words, em dashes or British spellings has moved from `www/brand/voice-baseline.json` (`www/brand/voice.md` § How this is kept) | Any copy: app strings, the site, the guide, the reference, the films, the README, the changelog and its entries in `changelog.d/` |
| Changelog | `python3 scripts/changelog.py --check` and `python3 scripts/test_changelog.py` (in `make dev-check`, and both in CI's *What changed* job, on every PR) | Every entry waiting in `changelog.d/` is one or more `### Kind: title` sections with no heading that would cut a release's notes short, and `CHANGELOG.md` has the one `## [Unreleased]` a release closes, with its note and nothing else before its first `###`; the assembler's tests cover the parse, the note, the merge order, the release and folding into an untagged one (`changelog.d/README.md`) | A changelog entry, `scripts/changelog.py` |
| Film tools | `make dev-check` (its `dev-film-tests` part) | The films' sound stays one source (`www/brand/sound.py --check`), and the film tools' own tests pass: the timeline's grammar, the film's bed and marks, the mix to the ladder (`www/video/tools/test_*.py`). The mix's tests need numpy and scipy: locally from `.venv-voice`, in CI's Web job pinned from `www/video/requirements-tools.txt` | Any change under `www/video/tools/`, `www/video/sound/` or `www/brand/sound.*` |
| wasm32 | `make wasm-check` | The engine compiles for the browser target, with no warnings (CI's engine build has `-Dwarnings`) | Rust in session or wasm |
| Crate tests | `make test-crate CRATE=<crate>` (`cargo test -p <crate> --profile test-fast --lib --bins --tests` with the pinned compiler; a bare `cargo` with Homebrew's first on PATH is not it) | That crate's gates | The crate you changed |
| CI's Rust tiers | `make test-fast-tier`, `make test-slow-tier` | The workspace split the way CI splits it (needs `cargo-nextest`) | To reproduce a CI leg by name |
| All tests | `make test` | The workspace, optimized (the examples are not built: `make lint` compiles them), and the doctests; includes `shipped_preset_wirings_are_current` (the shipped preset wirings match today's presets and named inputs) and `shipped_preset_wirings_measure_the_same_today` (a sample of them re-measures the same: standardizer, φ, wiring) | Before a commit that touches Rust or a preset |
| Coverage | `make coverage` (needs cargo-llvm-cov and the `llvm-tools` component: `make setup`) | Each crate's line and function coverage from the fast tier is at its floor (`crates/coverage-baseline.json`), and every line changed in `crates/` since `origin/main` (`BASE=` for another) is covered; the HTML report is `target/llvm-cov/html/index.html` ([Coverage](#coverage)) | Any Rust change, before review; `make coverage-floors` in a PR that raises a crate's coverage |
| Mutants | `make mutants DIFF=1` (the code changed since `origin/main`, `BASE=` for another), `make mutants CRATE=<crate>` (needs cargo-mutants at the `Makefile`'s `MUTANTS_VERSION`: `make setup`) | A test notices when the code is wrong: every mutant cargo-mutants makes of the code (a function returning a default, a `<` made `<=`) fails a test of its crate's fast tier. Each survivor is named by file, line, function and change in `mutants.out/missed.txt` ([`crates/AGENTS.md` § Mutation testing](../../crates/AGENTS.md#mutation-testing)) | Any Rust change, before review; a survivor there is a finding |
| Preset wirings | `make perform-wirings` | Regenerates `apps/web/perform-wirings.json` (minutes, natively) | A preset, the phrase, φ (features, normalization, vetting, DSP), the grammar prior or PERFORM changed (`make test` says so) |
| Native and wasm agree | `make test-crate CRATE=auracle-wasm TEST_TARGETS="--test boot_agrees"`; the wasm half is `tests/web/boot_agrees.spec.js` (after `make wasm`, no page opened) | The shipped seed deals the same trees, vetting and standardizer natively and in the built wasm, both pinned to `crates/auracle-wasm/tests/boot_probe.json` | A draw from an RNG, the prior, vetting, the standardizer fit; regenerate with `UPDATE_BOOT_PROBE=1` and owe what a moved pool owes. No Rust test fails without the `gen_index` fix on a target CI runs (CI's hosts are 64-bit, where it changes nothing), so the spec is the only regression guard against a width-dependent draw |
| Everything CI runs | `make check` | fmt, lint, js, the spec lint, wasm32, tests | Before every commit |
| Browser smoke | `make smoke` | Boots clean, worklet registers, failure flows contained | After `make wasm` |
| Browser suite | `make browser-fast`, `make browser-slow` (see `tests/web/AGENTS.md`) | Every behaviour a spec names | Any app behaviour change; in CI the fast tier is part of the required `CI` check and the `@slow` and `@quarantine` specs run in the *Slow suite* ([CI tiers](#ci-tiers), [Flakes](#flakes)) |
| Site | `make site && make site-check` | The site builds; every link, asset and anchor resolves | Any `www/` change, public API docs |
| Search health | `make search-check`, `make climb`, `make islands` | The search still improves the pool | Engine search changes |
| φ | `make revalidate` (both sides, diff), then `make perform-wirings`, then `cargo run -p auracle-features --example file_phi --release` | What the model can hear did not silently change; the shipped preset wirings are measured in the new φ; `FILE_MASKED` still names what a recording cannot measure (the mask gate test fails until it does) | Any φ, phrase, vetting or normalization change |
| Model | `make fit-bench`, `make closed-loop` | The posterior still recovers a synthetic user | Model or budget changes |

## CI tiers

CI runs in two tiers. A PR may merge on the fast tier alone.

| Tier | Where | Runs | Gates merging |
| --- | --- | --- | --- |
| Fast | `.github/workflows/ci.yml`, the `CI` check, in two lanes ([ADR-023](../decisions/023-the-gate-runs-in-the-queue.md)) | The voice check and the changelog's (`scripts/changelog.py --check` and its tests), in *What changed*, on every run; Lint; Web (`make web-check`, then `make -j4 -O dev-check`, its parts side by side); the engine for the browser, once per run (a wasm32 build under `-Dwarnings` when a crate, the Cargo files or the Makefile changed, main's cached build otherwise); Site (built with that engine); the Rust tests not named slow, instrumented for coverage (built once, run on three runners by slice, then one report: [Coverage](#coverage)); the doctests; every browser spec not tagged `@slow` or `@quarantine` (twelve runners, dealt by time). That is the full gate, the merge queue's run. A PR's own run is the fast lane, the part of it the change reaches, with Browser smoke (`make smoke`'s two specs) in place of the browser specs it can't pick (*The two lanes*, below) | Yes. The branch ruleset requires `CI` on a PR's head (the fast lane); the queue merges on the full gate's `Full gate` |
| Slow | `.github/workflows/slow-suite.yml`, *Slow suite* | The search floor (`make test-search-floor`); the other slow Rust tests (`make test-slow-rest`); every `@slow` and `@quarantine` browser spec (six runners, three at a time, dealt by time). On a PR only with the `full-ci` label | No |
| Flake hunt | `.github/workflows/flake-hunt.yml`, nightly | The fast tier's browser specs three times each, against main, on twelve runners four at a time ([Flakes](#flakes)) | No |
| Speed budgets | `.github/workflows/flake-hunt.yml`, nightly, beside the hunt | Every spec file that records a budget, each test once (`@slow` ones too), against main, with `AURACLE_PERF=1` at `AURACLE_CPU_THROTTLE=1`, on two runners; a budget over its limit files *Speed budgets over their limit* ([Rules](#rules)) | No |
| Mutants | `.github/workflows/mutants.yml`, *Mutants* | On a PR that changes a crate, the mutants in the changed code (`make mutants DIFF=1`) on one runner for at most 25 minutes, red when one survived; weekly and by hand, one part of the workspace (four shards, two runners at a time; the whole every twelve weeks), a survivor on `main` filing *Mutants that survive* ([Mutants](#mutants)) | No: review treats a survivor as a finding. Required once the crates are clean (#181) |

**The two lanes.** One workflow, and its *What changed* job picks the lane:

| Change | A PR's own run (the fast lane) |
| --- | --- |
| Docs, the site, `.claude/` or an `AGENTS.md` | Web, the engine (restored), Site |
| Spec files only | Web, the engine, Site, and those specs (one runner per file, up to four); more than twenty, Browser smoke instead |
| The specs' lint (`eslint.config.mjs`, `eslint-suppressions.json`, its tests) | Web, the engine, Site; beside spec files, those specs as above. No browser reads the lint |
| `main.js`, `worker.js`, `index.html`, `style.css` | Web, the engine, Site, then Browser smoke; no other spec |
| An app module `changed.mjs` maps (`patch.js`, `perform.js`, `faces.js` …) | Web, the engine, Site, then Browser smoke, and that module's specs on up to four runners |
| A test helper (`fixtures.js`, `shell.js`), the Playwright config, the lockfile | Web, the engine, Site, then Browser smoke; the specs a helper reaches when they are twenty files or fewer |
| A crate, `Cargo.*`, `rust-toolchain.toml`, the `Makefile` | Lint, Coverage, the Doctests, Web, the engine (built), Site, then Browser smoke |
| The coverage gate's scripts, `scripts/setup.sh` | Lint, Coverage, the Doctests, Web, the engine, Site |
| Another script (`scripts/*.py`: the changelog's assembler and its tests) | Web, whose `dev-check` runs the scripts' tests |
| A changelog entry (`changelog.d/`) | Nothing more: *What changed* checks the entries and the voice on every run, and the site doesn't read them |
| A workflow or an action (`.github/`) | The full gate, as the queue runs it |

- **The fast lane** narrows by the paths the PR changed. Its browser specs
  are the ones `make browser-changed` picks (`tests/web/changed.mjs`): a
  changed spec, the specs that require a changed helper, the specs named for
  a changed app module, one runner per file up to four, dealt by time. A
  change that reaches every level (`main.js`, `worker.js`, the engine) picks
  none, and gets the smoke only; so does a change that reaches more than
  twenty spec files (a helper nearly every spec requires, or that many specs
  changed at once). A green fast lane puts the PR in the queue. It is not the
  gate: a `main.js` change has run two specs when it enters the queue.
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
also folds the run's times into the timings the next run deals by (*The
timings come from the queue's run*, below). A runner that would
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
*What changed* job reads it: Lint, Web, the Doctests, Coverage and the
browser tier are skipped there when the record says they passed, and the
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

**The timings come from the queue's run.** Main no longer runs the browser
tier when it reuses the queue's verdict, so the queue run's *Browser report*
folds its times into main's timings and keeps the file as an artifact, and
main's *What changed* job saves it to the cache the next run deals from (a
cache saved by a pull_request run is restored by that PR's runs only).

**The workflows themselves.** Each workflow's token is read-only unless a
job needs more (filing an issue, deploying Pages). Every job runs on
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
on the open one. On demand from the Actions tab. On a PR, only when the PR
carries the `full-ci` label: adding it starts a run, and every push to the
labelled PR runs it again; a PR without it runs nothing there. Add it to a
PR that changes what the slow tests cover, the paths the workflow used to run
a PR for: any crate, `Cargo.toml` or `Cargo.lock`,
`rust-toolchain.toml`, the `Makefile`, `slow-suite.yml` or `.github/actions/`;
`apps/web/`'s `worker.js`, `farm.js`, `perform.js`, `patch.js`,
`live-audio.js`, `audio-in.js`, `explain.js`, `faces.js` or `vessel.js`;
`tests/web/`'s `fixtures.js`, `playwright.config.js`, `package.json` or
`package-lock.json`; or a spec file that holds an `@slow` or `@quarantine`
test. Also a `main.js` change that reaches EVOLVE's generations or PERFORM's
offers. Otherwise the push to `main` is where a slow
test catches it.

**Runners.** The account runs at most 20 jobs at once.
- **The queue's run** at its widest holds about 17: twelve browser runners,
  Site, the three Coverage runners, and one more for a Lint, Web or Doctests
  job still running, or the *Browser report*. One batch is tested at a
  time.
- **A PR's fast lane** holds at most eleven: four browser runners, the three
  Coverage runners, Site (then Browser smoke, which waits for Site and takes
  its place), and Lint, Web and the Doctests while they last. Only a PR that
  changes both Rust and an app module with specs of its own reaches that.
  A docs PR holds two (Web, then the engine and Site), an app PR without
  Rust five or six, a Rust PR seven.
- **The *Slow suite*** holds at most four (`max-parallel`: one Rust leg and
  three browser runners), on `main`, latest only.
- **After a merge**, main's `CI` reuses the queue's verdict and runs the
  engine and Site for the deploy: two.
- ***Mutants*** ([Mutants](#mutants)) holds one runner a PR for up to
  forty minutes (the job's limit; the run inside stops at 25), well after a
  crate PR's fast lane is done, and for about a minute on a PR that changes
  no Rust. Its weekly run holds two on Saturdays, for about eleven hours
  from 09:17 UTC.

So the queue's run and the *Slow suite* together are 21, one over: a merge
starts the *Slow suite* just as the queue starts its next batch, and that
batch can wait a few minutes for a runner. A PR's fast lane beside a queue
run fits when it is small (a docs or app PR) and waits for a few runners
when it is wide. Before two lanes, every PR's run was the full gate at 19
(the two plain Test runners as well), and a second PR in CI could not fit
beside it. *Mutants* adds a runner for each crate PR in flight: a crate
PR's fast lane (seven) and its *Mutants* job are eight, two such PRs
sixteen, and a queue run beside two crate PRs' *Mutants* jobs, once their
fast lanes are done, nineteen. On Saturdays the weekly run's two leave
eighteen: a queue run fits beside it with one *Mutants* job, and a crate
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

## Mutants

[cargo-mutants](https://mutants.rs) over the fast tier: each mutant, a small
change to the code, is built and its crate's fast tier run on it, and a
mutant no test fails on survives. What it runs, how to read a survivor and
what review does with one are the crates' rules, in
[`crates/AGENTS.md` § Mutation testing](../../crates/AGENTS.md#mutation-testing).
The *Mutants* workflow (`mutants.yml`) is not part of the required `CI`
check.

**On a PR that changes a crate**, one runner tests the mutants in the
changed code (`make mutants DIFF=1` against the merge base, in place, one at
a time) for at most 25 minutes, the unmutated build and tests included, then
stops and reports what it judged. The run's summary has the table and every
survivor and timeout, linked; the job is red when a mutant survived.

**Weekly** (Saturdays, 09:17 UTC) **and by hand**, one part of the
workspace: each crate's mutants are cut into shards (`PLAN` in the `plan`
job: taste 1, grammar 3, features 13, session 20, wasm 9), and each week
runs the next four, two runners at a time, each stopped at five and a half
hours. Forty-six shards make twelve parts: the workspace once every twelve
weeks. A run by hand takes this week's part, or the one its `part` input
names. A run on `main` that finds a survivor files or comments on
*Mutants that survive*, naming its part.

**How long.** Measured on Oct 6 at `db2103f`, on a 16-core Mac shared with
other work (load 17 to 76), at `nice -n 19` and two mutants at a time:

| Run | Mutants | Wall time | Caught | Survived | Timed out | Unviable | A mutant, on average |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `auracle-taste`, whole | 622 | 29.4 min | 428 | 166 | 2 | 26 | 3.1 s to build, 2.5 s of tests (of a 4.7 s suite) |
| `auracle-session`, 1 in 100 (round robin) | 21 | 10.3 min | 11 | 7 | 0 | 3 | 13 s to build, 37 s of tests (of a 46 s suite) |

A caught mutant costs little: nextest stops at the first failing test
(`--max-fail=1:immediate`), so taste's took 1.1 s of their 4.7 s suite and
session's 16 s of 46. A survivor runs every test (taste's 6.3 s, session's
86 s), so the cost falls as the crates' PRs kill survivors. Each crate's
fast tier alone, on the same machine under like load, took: taste 9 s,
grammar 1 s, features 38 s, wasm 40 s, session 64 s; rebuilding a crate's
tests after a change, 3 to 11 s.

**On a runner**, estimated, not yet measured. CI's Test job spends about
eleven minutes of a runner's time on the fast tier (two runners, five and a
half each), which this Mac runs in about a minute and a half unloaded: about
eight times slower. A build is taken to be about four times slower. A mutant
then costs about 15 s in taste, 25 s in grammar,
two minutes in features and wasm, and three to four in session, and the
workspace's 8,340 about 200 to 250 runner-hours. Four runners for six hours
a week are 24, hence the parts. `PLAN`'s counts are sized from these
estimates to keep each shard near five hours; a weekly shard that stops at
its cap is a measurement that says its crate needs more. The two timeouts
in taste were most likely the machine's load, not hangs: both stopped at
the 20 s floor, over a suite of 4.7 s, while survivors there took up to
four times the unmutated time.

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

- **The flake hunt** (`flake-hunt.yml`) runs nightly: the fast tier's
  browser tests three times each, against main, where nothing changed but
  the machine. The specs on the fixture that name no seed of their own boot
  unseeded there (`AURACLE_SEED=random`); on the gate they boot seeded
  (`tests/web/fixtures.js` `SEED`, the same pool and sides every run;
  PERFORM's specs `PERFORM_SEED`, whose first offer is a typical one), so a
  spec that only holds for one pool shows up here. A spec that names its own
  `random:` seed keeps it in both. A failure files a *Flake hunt found a
  flaky test* issue whose run links one report naming each failed test and
  which of its runs failed.
- **Fix it.** Most flakes here have been a wait on a time rather than a
  state, an exact count of something a slow machine may do twice, or a
  speed bound asserted where a budget belongs ([Rules](#rules)).
- **Or quarantine it** while it is fixed: add `@quarantine` to the test's
  tags (`{ tag: ["@quarantine"] }`, or beside `@slow`) with a comment naming
  the issue. It leaves the gate and runs in the *Slow suite*, so it is still
  run and still seen. Remove the tag in the PR that fixes it.

## What each browser spec pins

| Spec | Pins |
| --- | --- |
| `smoke.spec.js` | Clean boot, worklet registered, engine playable; the binary exports the walk surface, the `belief` call and the face calls `worker.js` calls |
| `session_seed.spec.js` | `?seed=N`: a fresh session with the same seed fills the same pool under the same names (each boot a browser context of its own), and another seed another |
| `boot_agrees.spec.js` | The built wasm's `boot_probe` (the shipped seed's first 400 trees, a small pool and its first duels) equals what native `shipped::boot_probe` pins in `boot_probe.json`; opens no page, about 3 s under Node |
| `fixture_tap.spec.js` | The fixture's tap (`fixtures.js`), on an echo worker with no app booted: a hold armed with `from` begins at the request it names and is spent once it has; `app.fail` answers a request as the worker answers one it could not run (an `engine_error` naming it, injected), the request still in `sent` and never at the engine, once or for every match, fatal or not; a speed budget is the test's annotation, and one over its limit fails the test only under `AURACLE_PERF=1`; on a worker that answers as `worker.js` does, a request's last reply (`app.replyTo`) is the one carrying its number without `more`, not the first of its type nor the engine's own news, `app.answered` waits while a request it covers has none and names it when it gives up, by type or lane, never for a request the worker never answers or one main did not number, and a reply `app.answer` or `app.fail` gives for a request carries its number |
| `failure_flows.spec.js` | Bad save, engine error, refused vote (and no ratings posted for it), profile import are contained |
| `first_run.spec.js` | The warm start keeps all 18 preferences; PERFORM's first steps tick off in the guide pill |
| `guide_pill.spec.js` | The guide pill (Plan-008 C1) shows one step at a time, bottom left of the stage under PERFORM's well and on PERFORM only, ticks each off as it happens (a note, a turn, an offer), says what the loop was and goes; × stops it across a reload (`auracle-guide`); the first steps' old ticks (`auracle-perform-steps`) carry over and the old key goes |
| `perform_layout.spec.js` | PERFORM as the specimen's well and panel at 1000, 1280 and 1440 px: the sound left of what you turn, the pad row WANDER · OFFER · PEEK · TAKE · PASS above the keybed with nothing cut; XY is a mode of the well (the button or Esc puts the face back, focus to the button) and How it works the other; Freeze is a tap or Enter on Wander, said on Wander; the moved bar shows only when the sound has left home, without moving the name, and BACK and KEEP settle it; Blend shows only while B holds an offer, and PASS passes without growing another, recorded as Next's pass after its window, its UNDO bringing B back (`@slow`) |
| `perform_touch.spec.js` | On a tablet (a coarse pointer and touch) no pad shows a printed key, and every PERFORM function the layout moved is a tap away: Wander's freeze, XY in the well and its field, the moved bar's KEEP, HOW IT WORKS, ARRANGE's velocity row, stage mode's tap and ×; EVOLVE's ⇄ circuit and what each generation did |
| `pad_keys.spec.js` | ADR-018's keys: N offers and with B full passes and offers again, B held is PEEK held, ⇧↵ takes (`@slow`); ↵ keeps only with no control focused, ⇧⌫ goes back, and at home each says there is nothing to do; the keys yield to a text field and a modal, the note keys still play, and N in EVOLVE deals another pair |
| `evolve_cards.spec.js` | EVOLVE's cards (Plan-008 C1): each sound's face large in its card's well, ⇄ circuit swapping it for the patch and back, ↓ patch opening it in PATCH; the relabelled buttons keep their ids; the small map goes to TASTE; EVOLVE POOL is dashed and pressable before the first fit; what each generation did opens over the foot of the cards and Esc folds it |
| `bank_row.spec.js` | A bank row's controls appear on approach and work |
| `evolve_feedback.spec.js` | TAUGHT counts at once, pick toasts replace, the dealing rule, the sixth-pick redraw, every pick's reply carrying ratings that move per pick (ten seeds, ten may-replace), bank ▶ |
| `patch_editing.spec.js` | The bench lane: edits in order, no lost edit, knobs survive redraws, receipts; KEEP AS NEW's blind card (Esc cancels), the one-shot *pick the edit*, a commit retiring the edits' receipts |
| `taste_marks.spec.js` | A guess drawn hollow with a ? in LEARNING's weights and the module rail; the module rail's spec card says a settled lean in sentences; TASTE's and LEARNING's early states count what is left |
| `taste_learning.spec.js` | A pick draws an arrow from the sound passed to the sound picked, from the engine's reply (and on arrival for a pick made elsewhere), held and then gone under reduced motion; every halo moves to the ratings a pick posts, and a refit settles them all at once; LEARNING's weights, forecasts and math are the worker's numbers (`model_facts`, `forecasts`); copy as JSON gives them back; a mark's slot keeps its label's x; a style renamed on its chip, its ▶ pressed straight after still plays; the track replays the posted history, after a reload too; SOUND and TASTE; pointing at a weight shades the small map by the posted z; the bars equal the styles posted after each pick; REPLAY steps through θ as posted, in order; a REPLAY step across a refit is the refit's, with no pick's ghost or light |
| `taste_profile.spec.js` | Reset asks with counts, downloads first and keeps saved patches; Save says what it downloaded |
| `narrow_gate.spec.js` | The narrow-window notice at any pointer under 1000 px, not over the handheld gate or "look around anyway" |
| `keys_are_not_notes.spec.js` | A letter or digit a list, the rack or a dialog handles is not also a note or a rating |
| `evolve_truth.spec.js` | ⌘Z outside PATCH changes nothing unseen; the sixth pick is undoable; "it just learned" follows `fitted`; with no pair waiting, a skip or a slow deal is inert and says why; a cut patch is not dealt (every deal asked for after the cut excludes it and no pair put up after it holds it), even by a deal asked for while its cut was taken back, whether that deal lands before the patch is cut again or after, or the table waits on its fourth try; opens are quiet unless slow (the app's own `patch-opened` mark says how long each waited), and a slow one is said in a sentence; tab click then → picks; keys a list uses are not notes; with no farm (`?farm=0`) a deal during a generation names the seed it waits on |
| `evolve_ahead.spec.js` | A pick or ↻ puts the pair dealt ahead up at once, sounds and all (in the click's own task, with no deal for the table asked for and no render for its ▶; the milliseconds a budget); a taken-back pick restores its pair and keeps the pair that replaced it as the next, or, when the table was still waiting on a deal, that deal; a patch cut while its pair waits ahead is never put up; pairs go up in the order they were dealt when a pick lands while the next deal is out |
| `evolve_breeds_beside_you.spec.js` | EVOLVE POOL completes on the farm with children landing in job order at the top of the bank; a pick mid-generation deals within 1 s; GENERATIONS and the next-step chip count a generation once a child has landed, not on a pick's status; PERFORM measures and a pressed Offer starts during a generation; stop ends with what's bred, retiring only at the finish; ⚡ leaves the engine free and its stop drops it; ⚡ and EVOLVE POOL take turns, each disabled with its reason while the other runs; the E and the job slot agree |
| `evolve_from_new.spec.js` | A ⚡ child joins the bank's New group (*new · generation N*, tagged NEW) as a generation's children do, the next-step chip counts it, and its toast names the sound; a ⚡ that bred nothing never says "its parent" |
| `bank_kept.spec.js` | A sound kept as new that rates lowest of everything a preset could replace (from the engine's own ratings, its original saved) stays when a preset opens on a full pool; the one replaced in its place is what the toast names; pointing at EVOLVE POOL never marks it *may be replaced*. Fails against an engine without the protection (`Candidate::unjudged`) |
| `bank_lineage.spec.js` | Pointing at EVOLVE POOL marks the seeds and what may be replaced from the engine's `ratings`, and during a generation its own seeds (posted with its progress, checked against each walk's `seed`) and `retiring` as *will be replaced*; no mark (the unheard dot, NEW, seed, may be replaced) moves or narrows a row's name, measured; the unheard dot survives a reload and clears when heard; Compare shows a child beside its seed, the diff and both ratings, and plays both while both exist; a refused child buds beside its seed and is gone, and EVOLVE POOL names each walk's outcome; a generation's children land in New with their seed and what changed, and Replaced lists only the names its end replaced; Compare lists every change and scrolls, and opens with c from the bank; while ⚡ walks, its seed and the sound its child would replace are marked, and that is what it replaces; a ⚡ child that replaced nothing leaves Replaced as it was; the name's place and each mark word's fit are measured at 1440 and 1080 px; GENERATIONS counts a generation from its first child with no pick since it opened; a sound saved mid-run loses *will be replaced* and the one that will go instead gains it |
| `faces.spec.js` | A face lands on every row, EVOLVE card, PATCH's header and teach strip, PERFORM's sound in hand and its offer (the offer's its own), and the warm start's cards; a cut redraws the bank's faces against the bank as it is now; a row's name has the same x and width with and without its face, uncut, on a desktop and a phone; the sound's card downloads at 1200 × 630 with its face, its name and its patch inside (PNG and SVG); after a reload every row draws the same face |
| `budgets.spec.js` | The response-time budget: the timing marks exist; a preset's controls, and a warm-start pick's, are live in the task PERFORM names it, wired from the shipped file (the app's `perform-wired` mark); a pick puts the next pair up in its click's own task with no deal for the table asked for, and the duel's ▶ sounds in its own with no render asked for. The seconds are budgets, recorded and judged nightly: ≤ 1 s from the click or *teach it*, 0.3 s, 0.15 s |
| `perform_controls.spec.js` | Half-closed controls stop at centre, XY axes (in the well's XY mode), the status line |
| `perform_open_early.spec.js` | With the engine's messages held: a Keep while a patch is still opening is refused and says why; the preset clicked last is the one opened; an open that cannot complete puts the voices back on the rack |
| `perform_instant.spec.js` | With the shipped file blocked, the player's cache: a revisit wired from it, after a reload too (the app's `perform-wired` mark says *cached*, not measured again; 0.5 s and 1.5 s are budgets), and a preset opened before wired from the click with every message to the engine held; a preset opened, or a patch measured, just before a reload is remembered after it (both caches are written as the page is left); a spare offer lands at once (B holds it by the end of the press's own task, and the press asks the engine for none); a kept wiring stamped by a build before the render namespace (a new quiver) plays at once, is re-measured, and is replaced |
| `perform_next.spec.js` | A spare grows while B holds an offer, so NEXT is as fast as Offer (B holds it by the end of the press's own task, and the press asks the engine for none); the pad reads NEXT · passes on B; a heard pass has UNDO (B back, nothing recorded) and counts after its window; an unheard pass says it was not counted |
| `perform_wander.spec.js` | Wander's first move ~1.5 s after it is let go in a new zone; its own drag is not a touch; zone ticks; the *ideas* zone; its caption carries its state and counts down; the status line keeps to the patch; its tooltip and how it works say a tap freezes it |
| `perform_recentre.spec.js` | A re-centre glides home with a fading ghost; a background re-check with the same knobs leaves a turned control where it is; a MIDI pot on Blend is let go when Blend comes home and takes it again from home |
| `perform_teaches.spec.js` | An offer heard and answered is a pick; unheard, it is not |
| `perform_offer_latency.spec.js` | With the page's own `later` work done (the shipped wiring's re-check, the page's spare) and then a very long spare offer growing, a pick (`perform_record`) is answered within max(2 s, twice a measured step) and a Keep says so within max(4 s, six steps), the spare still growing (the page's CPU is throttled 4x, which need not reach the engine worker, so the bounds rest on the measured step); leaving the patch (`retire`) stops the running walk, answered `retired`; an Offer pressed while the guess waits for its render crew (the crew's ports held back from the engine worker until the Offer is answered, so the guess is still out every run) is answered within max(2 s, three steps) |
| `perform_palette.spec.js` | The palette places, hides and orders up to eight controls, and the panel comes back after a reload; a placed control is measured with the panel's set (asked in palette order), keyed by that set, and says *listening…* until it is; each knob wears its own control's wiring and an aimed offer names its control by palette index on a panel in another order; HOW IT WORKS lists every placed control and opens on the one last touched; a row's mark never moves its name |
| `perform_offer_moments.spec.js` | B grows from the sound's face in the well, a taken B fills and goes into the face, a passed B folds back into it (each motion's keyframes against the page); an offer taken unheard becomes the sound and records no pick (no `perform_record`), and taken heard records one; a heard Take kept as new inside its eight-second window is recorded after the keep with an `asOf` below the kept id, so it does not judge the kept sound |
| `perform_stage.spec.js` | ⇧F enters stage mode and ⇧F or Esc leaves; Space plays in it and it draws only while sound plays; F alone is still a note; ⇧F is stage mode in PERFORM only and the accented F in PATCH; Tab stays inside it and focus comes back on leave; a refusal said in it is in sight |
| `explain.spec.js` | Each control on the panel opens its figure (by ?, by its chip, from the switcher and the arrow keys), asked of the engine for that control on the sound in hand, and a view change puts it away; every one of the palette's eighteen opens its figure (`@slow`); a control asked about before it is measured answers once it is, a search control too; a turn with an answer open asks at most twice; Space plays with an answer open and in the lesson, after a click on their buttons too, and NEXT takes Enter only; the lesson says why a render failed (injected), draws and plays nothing for it, says when the filter goes after a sound with no room, and asks nothing more after the sound itself fails; ? is the key map's once the pointer has left a control a mouse turned, and never opens over an answer; a long press on a touch screen opens the answer and a moving finger does not (CDP touch); with a bank of faces, BRIGHT's figure and the lesson draw the sound's face from the portrait's own; with no answer or lesson open, a pressed Offer grows with no explain request sent, and an answer put away cancels its waiting request (answered as `cancelled`); `AURACLE_CPU_THROTTLE=4` runs them at a quarter speed, the engine worker too (the fixture's boot); a figure's sentence is built from the worker's reply (BRIGHT's center, made and turned) and follows its control when turned; the lesson on filters renders the sound in hand, its cutoff's readout is the reply's and the filtered top sits lower, and another sound gives another lesson; under reduced motion a figure is drawn whole and holds, and with motion MOTION's runs; asking moves no control's or bank row's label |
| `perform_aimed.spec.js` | A search control's offer is asked for aimed (control and way), B counts while it grows and then says how far it moved, in amber; the Offer pad's offer is not aimed |
| `perform_circuit.spec.js` | A knob turned in PERFORM is drawn performed in PATCH |
| `perform_truth.spec.js` | Half-closed rings on the open side and their captions; *listening…* is never the search look and never grafts; first steps name a control that turns; choosing an XY axis gives the keys back; search controls spring back; Blend home after a pass; a drift's re-check is background; a stalled shipped-wirings fetch still lets a preset be measured; a re-check or a first measurement the engine never answers (an injected `engine_error` naming its `req`, the engine slowed fourfold so it is still out) is let go, the status saying it couldn't re-check or measure the patch instead of *re-checking* or *listening…*, and so is a measurement asked for before the engine has booted (its `init` stalled by the tap, a patch handed to PERFORM as `tree_json`, the worker answering `not_ready` with the request's `req`); after a crash (the engine poisoned, every request answered with a fatal `engine_error`) no spare is asked for by itself and a pressed Offer is not sent, B saying the engine crashed; an offer whose walk crashed the engine says so in B even when its own empty reply came before the crash (a worker from before the worker answered a trap with the crash alone, which `apps/web/tests/worker-perform-replies.test.mjs` pins); a module the engine fails to add (an injected non-fatal `engine_error` for `perform_graft`) is said to have failed and grows no offer in its place |
| `patch_truth.spec.js` | An unplugged socket goes quiet and reads EMPTY; a knob turned in PATCH keeps its value with no ghost, and PERFORM plays from it |
| `patch_audible.spec.js` | Measured at the output: a VCO's wave cycled in PATCH has each wave's harmonics under a held note and on ▶ and Space; a selector changed under a held note keeps its level while the engine renders it (nothing reaches the voices before the reply) and plays at its measured makeup once it lands; a knob whose check finds a runaway is muted, as the alarm says, until a check passes; a selector whose check fails is not applied and the alarm says so, and a knob turned after it is not muted for it; an edit's reply leaves alone the makeup of a preset opened from memory while the edit rendered; an undo and a redo of a selector reach the voices at their measured makeup, so a held note's level holds while they render; a cutoff turned down lowers the centroid live and on ▶; ▶ or Space pressed while the edit is still at the engine plays the edit, not the sound before it; Space in PERFORM and EVOLVE plays the edited sound, waiting for an edit the same way, and the sound in hand in the menu bar says it waits from before the edit lands; that waiting ▶ is lit before the edit lands (100 ms after the press is a budget for each), and a second press, Space, another ▶ or leaving PATCH takes it back; Space with ▶ disabled says why and plays nothing |
| `audio_in.spec.js` | AUDIO IN, with the browser's inputs stubbed (tones per fake device, never a microphone): the browser is asked only when AUDIO IN is added, and says what for while it asks; a refusal keeps the module, silent, with ASK AGAIN; each device opens once and fans out to every module reading it (and the input menu reuses it); a tone in is heard at the output with no key down once MONITOR is on and not at all while it is off (a key held or not), monitoring is off after a reload and a sound that listens opens its input without a prompt; the first listen captures a clip the engine takes, NEW CLIP another; a restore that installs a captured clip re-sends the farm's phrase, and (`@slow`) a capture re-sends it to a crew standing; an unplug silences the module and says so, a replug plays again; the browser's `default` is numbered as the input it stands for when only the list's "Default - X" names it; the square draws the input's live face while it plays and nothing, level included, once it is unplugged |
| `audio_in_takes.spec.js` | TRACK and CAPTURE, on the same stub (`audio_in_stub.js`): both in the module rail, and placing TRACK asks for an input; a tracked sound monitored plays from the input with one voice, and keys over it sound as voices of the tracked note (held, the output's RMS sits within −3 to +11 dB of the tracked voice's: four voices at one pitch sum by phase, so the 440 Hz bin can't carry a band) and stop with their keys (the level after they are let go is the tracked voice's alone); CAPTURE's RECORD puts a take of its input in the sound as an edit, the module says its length, and a key plays it; a STOP the worklet answers with no frames sends no take and says nothing was recorded (the worklet's own half, exactly, in `apps/web/tests/worklet-take.test.mjs`); moving to another sound while RECORD is lit stops it, and the take lands on neither sound, while a keep as new is the same sound and the take lands on it; a sound whose take couldn't be read is kept safe under *kept safe* and RECORD AGAIN brings it back into the pool, waiting for its input to open (held open by the stub) and recording that input while the bench reads another; a refused input says so and records nothing; the bank's cursor reaches a sound kept safe past the pool's last row, and Enter presses RECORD AGAIN; AUDIO IN's and CAPTURE's buttons are on the rack's keyboard walk (the arrows reach them after the knobs, a hidden one is passed by, Enter or Space presses them, Escape backs out to the plate, and the focus stays on RECORD through the redraw its take makes) |
| `patch_guess.spec.js` | The model's guess for the next module, read as the worker posts it: the top guess drawn at its socket with GUESS · ‹module›, its reason and forecast in the model's italic (and *it may not help* when its lower bound is under zero), the rail's mark beside its name without moving the name; a skip shows the next guess, not that family at that socket; adding it sends the guess with the edit; ⌘Z of an added guess counts as a skip; nothing before the warm start (`no_taste`), with no render crew raised for it; every candidate ranked on a crew, the likeliest eight with `?farm=0` and no crew asked for; a skip made after KEEP AS NEW still holds when the kept sound is opened again; a new patch's skips are not the sound's it was started from; a guess added after its socket was filled is refused with the engine's reason; a guess asked while boot's crew is still filling the pool waits for it and is then ranked on a crew, every candidate |
| `patch_cables.spec.js` | Each audio cable's light and level mark follow the levels `cable_levels` posts, one per cable, keyed `from>to` as the rack draws them; modulation cables carry neither; never more than one probe at the engine; a knob drag asks for one probe after it settles, its marks hollow until then; every paint of a new structure before its levels arrive is unlit, with hollow marks; with two sounds opened right after arriving in PATCH, every probe and guess goes out with no open on its way and at least the quiet window (`ARRIVE_MS`, 1.2 s) after arriving and after the last open landed; a PERFORM measurement nobody is waiting on (`bg`), sent just before a knob turn's probe, does not hold the probe or the cables' light back, and still finishes |
| `patch_from_nothing.spec.js` | NEW PATCH leaves one empty socket and the amp, named *New patch* and counted in its caption; modules added from the rail; a processor deleted and put back with the toast's undo; a source deleted leaves its socket empty; CLEAR and its undo; BACK TO ‹name› reopens the sound, and NEW PATCH brings the new patch back; ⌘Z past its start ends it; Esc on a plate button (CAPTURE's RECORD) backs out to its plate and keeps the new patch |
| `patch_sheet.spec.js` | On a coarse pointer, a tapped module opens a sheet with a row for every knob the engine describes (a slider with − and + of at least 44 px, or the setting's choices); + edits the knob through the lane, a choice sets a named setting and the arrows move between choices, focus goes into the sheet and leaves it with ×, a tap on another module opens that one; an AUDIO IN in the patch is drawn with its three settings, and its sheet has them; a tap on a plate button (CAPTURE's RECORD) presses it and opens no sheet |
| `patch_model_view.spec.js` | PATCH's model view (Plan-008 C2b), with a pinned fit: nothing of it at rest; held ⌥ and a tapped MODEL show the belief line in place of the subtitle, a lean edge only on the settled family's plate, one worth chip per family (two VCOs, one chip, *shared by 2*, a guess dashed), the ranking's runners-up with their lower bounds, the patch's parts in the readout and a selected module's lean over it; letting go rebuilds no plate; no "lens" in what it shows (`@slow`) |
| `patch_facts.spec.js` | PATCH's four engine facts: the face without the selected module is the worker's face for the patch with it bypassed, and the only source says *silent without it*; What goes here? sends `at` from the ⋯ and from Q, draws the ghost at that place with its place words, Esc returns to the output's guess and Enter takes exactly the ranked edit (`@slow`); a ⚡ child shows *from Reese · N changes*, its ticked modules and seed pointers as its `LineageEvent` says, gone after an edit and back after undo to as opened (`@slow`); the readout names the PERFORM controls PERFORM's measurement says turn a knob, and a module's |
| `space_after_a_click.spec.js` | A click leaves no focus on the wave or filter-mode chip, and Space then plays and leaves the chip alone (the second Space stops it: the app stops the phrase's source, and the output goes quiet); a chip reached with the keyboard cycles on Space and Enter and back with Shift, its name carrying its value and each cycle read out; in PERFORM, Space plays after a drag on a control, a click on the XY pad, and a tap on Wander (which stays frozen); the ⋯ menu's file items open their dialog on Enter and Space |
| `midi_announced.spec.js` | A MIDI knob that claims or learns a control is announced in a sentence (*CC 74 now moves Bright, the first free control.*), the later replacing the earlier |
| `keys_for_the_platform.spec.js` | The ? card, the booth menu and the minimap's tooltip print ⌘ and ⇧ on an Apple platform and Ctrl and Shift elsewhere |
| `responsive.spec.js` | The player is answered first while PERFORM measures; warm-start ▶; Take keeps its controls, and once the engine answers the taken offer's measurement (waited for within `offerBudget`) the status stops saying *re-checking* (`@slow`: up to minutes on CI with a heavy offer); a Take's measurement is the player's again when PERFORM comes back from PATCH, landing before a drift asked for after it (`@slow`, the engine slowed fourfold) |
| `booth.spec.js` | Attract plays in PERFORM, hands over on a key, and teaches nothing |
| `film_chip.spec.js` | The menu bar's film chip |
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
  about 28% of the fast tier's test time).
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
