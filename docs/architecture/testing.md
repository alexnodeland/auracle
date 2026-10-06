---
title: "Testing: every gate, what it proves, when to run it"
last_updated: 2026-10-05
related_adrs: [3, 5]
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
| Web units | `make web-check` | Syntax, plus the pure modules' unit tests (`apps/web/tests/`) | Any JS |
| Tokens | `python3 www/brand/tokens.py --check` (in `make dev-check`) | Every generated block is current; no color is written outside the tokens; no token is redefined after its block; no file's count of literal font sizes, spacings, radii and durations (in its CSS, its scripts' styles, canvas fonts and animations, and the custom properties those use) has moved from `www/brand/sizes-baseline.json` (`www/brand/README.md` § The tokens) | Any stylesheet, a page's styles, a script that draws or styles |
| Voice | `python3 www/checkwords.py` (in `make dev-check`) | No file's count of banned words, em dashes or British spellings has moved from `www/brand/voice-baseline.json` (`www/brand/voice.md` § How this is kept) | Any copy: app strings, the site, the guide, the reference, the films, the README, the changelog |
| Film tools | `make dev-check` (its `dev-film-tests` part) | The films' sound stays one source (`www/brand/sound.py --check`), and the film tools' own tests pass: the timeline's grammar, the film's bed and marks, the mix to the ladder (`www/video/tools/test_*.py`). The mix's tests need numpy and scipy: locally from `.venv-voice`, in CI's Web job pinned from `www/video/requirements-tools.txt` | Any change under `www/video/tools/`, `www/video/sound/` or `www/brand/sound.*` |
| wasm32 | `make wasm-check` | The engine compiles for the browser target, with no warnings (CI's engine build has `-Dwarnings`) | Rust in session or wasm |
| Crate tests | `make test-crate CRATE=<crate>` (`cargo test -p <crate> --profile test-fast --lib --bins --tests` with the pinned compiler; a bare `cargo` with Homebrew's first on PATH is not it) | That crate's gates | The crate you changed |
| CI's Rust tiers | `make test-fast-tier`, `make test-slow-tier` | The workspace split the way CI splits it (needs `cargo-nextest`) | To reproduce a CI leg by name |
| All tests | `make test` | The workspace, optimized (the examples are not built: `make lint` compiles them), and the doctests; includes `shipped_preset_wirings_are_current` (the shipped preset wirings match today's presets and named inputs) and `shipped_preset_wirings_measure_the_same_today` (a sample of them re-measures the same: standardizer, φ, wiring) | Before a commit that touches Rust or a preset |
| Preset wirings | `make perform-wirings` | Regenerates `apps/web/perform-wirings.json` (minutes, natively) | A preset, the phrase, φ (features, normalization, vetting, DSP), the grammar prior or PERFORM changed (`make test` says so) |
| Native and wasm agree | `make test-crate CRATE=auracle-wasm TEST_TARGETS="--test boot_agrees"`; the wasm half is `tests/web/boot_agrees.spec.js` (after `make wasm`, no page opened) | The shipped seed deals the same trees, vetting and standardizer natively and in the built wasm, both pinned to `crates/auracle-wasm/tests/boot_probe.json` | A draw from an RNG, the prior, vetting, the standardizer fit; regenerate with `UPDATE_BOOT_PROBE=1` and owe what a moved pool owes. No Rust test fails without the `gen_index` fix on a target CI runs (CI's hosts are 64-bit, where it changes nothing), so the spec is the only regression guard against a width-dependent draw |
| Everything CI runs | `make check` | fmt, lint, js, wasm32, tests | Before every commit |
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
| Fast | `.github/workflows/ci.yml`, the `CI` check | The voice check (in *What changed*, on every PR); Lint; Web (`make web-check`, then `make -j4 -O dev-check`, its parts side by side); the engine for the browser, once per run (a wasm32 build under `-Dwarnings` when a crate, the Cargo files or the Makefile changed, main's cached build otherwise); Site (built with that engine, with `make smoke`); the Rust tests not named slow (`make test-fast-tier`, split over two runners by slice); every browser spec not tagged `@slow` or `@quarantine` (twelve runners, dealt by time) | Yes. The branch ruleset requires `CI`; every job above is inside it |
| Slow | `.github/workflows/slow-suite.yml`, *Slow suite* | The search floor (`make test-search-floor`); the other slow Rust tests (`make test-slow-rest`); every `@slow` and `@quarantine` browser spec (six runners, three at a time, dealt by time). On a PR only with the `full-ci` label | No |
| Flake hunt | `.github/workflows/flake-hunt.yml`, nightly | The fast tier's browser specs three times each, against main, on twelve runners four at a time ([Flakes](#flakes)) | No |

**How long.** The fast tier's browser tests are about seventy-five minutes
of test time in one worker (284 tests at `42bd322`, each a fresh boot), so
they set the check's length: about eleven minutes, the engine job and twelve
runners planned at about six minutes each (the hosted runners differ in
speed by about two times, and each shard's log and the run's summary name
its CPU). Rust takes about seven and a half (a two-minute compile,
then the tests); Web and Site take two to three.

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
(`npx playwright show-report <dir>` opens it). On main it also folds the
run's times into the timings the next run deals by. A runner that would
outlast its job ends first: Playwright's global timeout
(`AURACLE_GLOBAL_TIMEOUT_MIN`) sits five minutes under the job's limit, and
a minute before it `shard.mjs` interrupts the run, so the test that was
running is reported as interrupted, with its trace. The setup's network
steps (npm, Playwright's download, the apt mirror) are each cut at three
minutes, with a message naming the server.

**A PR that changes only specs** runs those specs and nothing else, on one
runner per spec up to twelve: no other spec's code changed, and the app it
runs against is main's. A change to a spec's helpers, the config or anything
else the browser tier reads runs the whole tier; main always does.

**On main, what the PR already passed is not run again.** A push to main is
a squash merge by the merge queue
([ADR-021](../decisions/021-merges-go-through-mergifys-queue.md)), which
merges a PR only on a run that tested it on main's tip, so its files are
exactly the files the PR's run tested (a pull_request run tests the PR
merged into main). That run's `CI` job leaves a record (the artifact
`verified-tree-<git tree>`, kept 14 days) of the jobs that passed on those
files, and main's *What changed* job reads it: Lint, Web, the Rust tests and
the browser tier are skipped there when the record says they passed, and the
run's summary says so, with a link. A job the PR skipped or ran in part (a
spec-only PR's browser tier) runs on main as before; so does everything when
main moved on after the PR's run (a merge by hand, outside the queue), on a
manual run, and for a PR from a fork.
The Site job always runs on main: its build is what deploys. The *Slow
suite* and the nightly flake hunt still run in full.

**The site deploys from CI.** On main, the Site job keeps the site it built
and checked, and the *Deploy to Pages* job publishes it once `CI` is green;
a red run deploys nothing and the last green build stays live. A run on
main is not cancelled by the next push, and none is skipped: main's runs
wait in a queue (`queue: max`) and run in turn, so when three merges land
inside one run's length each is tested and deployed in order. Lint and the Rust tests are reused only while `rust-toolchain.toml`
still pins the release they ran on (the record keeps `rustc --version`).

**The workflows themselves.** Each workflow's token is read-only unless a
job needs more (filing an issue, deploying Pages). Every job runs on
`ubuntu-24.04`, not `ubuntu-latest`, so a new runner image arrives in a PR of
its own, and every Rust job builds with the compiler `rust-toolchain.toml`
pins (`rustup toolchain install`), as `make` does locally, so a new Rust
release does too. Every action is pinned to
a commit SHA with its version in a comment; Dependabot
(`.github/dependabot.yml`) opens one grouped PR a week for the actions and
one for `tests/web`'s npm packages.

**When the slow tier runs.** On every push to `main` and nightly, in full; a
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

**Runners.** The account runs at most 20 jobs at once. A PR's `CI` at its
widest holds 16 (twelve browser runners, Site, the two Rust test runners and
one more); the *Slow suite* holds at most four (`max-parallel`: one Rust leg
and three browser runners), so the two fit together. A merge also starts
`main`'s own `CI`, which re-runs what the PR's run did not cover (of 20 runs
on `main` before Oct 6, the whole browser tier in 9, both Rust test jobs in
15, Site in all), so a PR pushed right after a merge can wait for runners
until `main`'s run is done; the merge queue
([ADR-021](../decisions/021-merges-go-through-mergifys-queue.md)) keeps
merges one at a time. The nightly *Flake hunt* holds four, beside *Search health*'s three
long jobs.

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

## Flakes

The gate runs every test once, with no retries, in CI as locally. A test
that passes only sometimes is a finding about the app or the test, and a
retry would hide it while charging every run its timeouts (a browser spec's
waits run to two minutes).

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
  timing bound with no slack ([Rules](#rules)).
- **Or quarantine it** while it is fixed: add `@quarantine` to the test's
  tags (`{ tag: ["@quarantine"] }`, or beside `@slow`) with a comment naming
  the issue. It leaves the gate and runs in the *Slow suite*, so it is still
  run and still seen. Remove the tag in the PR that fixes it.

## What each browser spec pins

| Spec | Pins |
| --- | --- |
| `smoke.spec.js` | Clean boot, worklet registered, engine playable; the binary exports the walk surface, the `belief` call and the face calls `worker.js` calls |
| `session_seed.spec.js` | `?seed=N`: a fresh session with the same seed fills the same pool (each boot a browser context of its own), and another seed another |
| `boot_agrees.spec.js` | The built wasm's `boot_probe` (the shipped seed's first 400 trees, a small pool and its first duels) equals what native `shipped::boot_probe` pins in `boot_probe.json`; opens no page, about 3 s under Node |
| `fixture_tap.spec.js` | The fixture's tap (`fixtures.js`), on an echo worker with no app booted: a hold armed with `from` begins at the request it names and is spent once it has; `app.fail` answers a request as the worker answers one it could not run (an `engine_error` naming it, injected), the request still in `sent` and never at the engine, once or for every match, fatal or not |
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
| `evolve_truth.spec.js` | ⌘Z outside PATCH changes nothing unseen; the sixth pick is undoable; "it just learned" follows `fitted`; with no pair waiting, a skip or a slow deal is inert and says why; a cut patch is not dealt (every deal asked for after the cut excludes it and no pair put up after it holds it), even by a deal asked for while its cut was taken back, whether that deal lands before the patch is cut again or after, or the table waits on its fourth try; opens are quiet unless slow, and a slow one is said in a sentence; tab click then → picks; keys a list uses are not notes; with no farm (`?farm=0`) a deal during a generation names the seed it waits on |
| `evolve_ahead.spec.js` | A pick or ↻ puts the pair dealt ahead up at once, sounds and all; a taken-back pick restores its pair and keeps the other as the next, even with the next deal still out; a patch cut while its pair waits ahead is never put up; pairs go up in the order they were dealt when a pick lands while the next deal is out |
| `evolve_breeds_beside_you.spec.js` | EVOLVE POOL completes on the farm with children landing in job order at the top of the bank; a pick mid-generation deals within 1 s; GENERATIONS and the next-step chip count a generation once a child has landed, not on a pick's status; PERFORM measures and a pressed Offer starts during a generation; stop ends with what's bred, retiring only at the finish; ⚡ leaves the engine free and its stop drops it; ⚡ and EVOLVE POOL take turns, each disabled with its reason while the other runs; the E and the job slot agree |
| `evolve_from_new.spec.js` | A ⚡ child joins the bank's New group (*new · generation N*, tagged NEW) as a generation's children do, the next-step chip counts it, and its toast names the sound; a ⚡ that bred nothing never says "its parent" |
| `bank_kept.spec.js` | A sound kept as new that rates lowest of everything a preset could replace (from the engine's own ratings, its original saved) stays when a preset opens on a full pool; the one replaced in its place is what the toast names; pointing at EVOLVE POOL never marks it *may be replaced*. Fails against an engine without the protection (`Candidate::unjudged`) |
| `bank_lineage.spec.js` | Pointing at EVOLVE POOL marks the seeds and what may be replaced from the engine's `ratings`, and during a generation its own seeds (posted with its progress, checked against each walk's `seed`) and `retiring` as *will be replaced*; no mark (the unheard dot, NEW, seed, may be replaced) moves or narrows a row's name, measured; the unheard dot survives a reload and clears when heard; Compare shows a child beside its seed, the diff and both ratings, and plays both while both exist; a refused child buds beside its seed and is gone, and EVOLVE POOL names each walk's outcome; a generation's children land in New with their seed and what changed, and Replaced lists only the names its end replaced; Compare lists every change and scrolls, and opens with c from the bank; while ⚡ walks, its seed and the sound its child would replace are marked, and that is what it replaces; a ⚡ child that replaced nothing leaves Replaced as it was; the name's place and each mark word's fit are measured at 1440 and 1080 px; GENERATIONS counts a generation from its first child with no pick since it opened; a sound saved mid-run loses *will be replaced* and the one that will go instead gains it |
| `faces.spec.js` | A face lands on every row, EVOLVE card, PATCH's header and teach strip, PERFORM's sound in hand and its offer (the offer's its own), and the warm start's cards; a cut redraws the bank's faces against the bank as it is now; a row's name has the same x and width with and without its face, uncut, on a desktop and a phone; the sound's card downloads at 1200 × 630 with its face, its name and its patch inside (PNG and SVG); after a reload every row draws the same face |
| `budgets.spec.js` | The response-time budget: the timing marks exist; a preset's controls live ≤ 1 s from its click; a warm-start pick's ≤ 1 s from *teach it*; pick → next pair ≤ 0.3 s; duel ▶ ≤ 0.15 s |
| `perform_controls.spec.js` | Half-closed controls stop at centre, XY axes (in the well's XY mode), the status line |
| `perform_open_early.spec.js` | With the engine's messages held: a Keep while a patch is still opening is refused and says why; the preset clicked last is the one opened; an open that cannot complete puts the voices back on the rack |
| `perform_instant.spec.js` | With the shipped file blocked, the player's cache: a revisit wired ≤ 0.5 s, ≤ 1.5 s after a reload (from the cache, not measured again), and a preset opened before wired from the click with every message to the engine held; a preset opened, or a patch measured, just before a reload is remembered after it (both caches are written as the page is left); a spare offer lands at once; a kept wiring stamped by a build before the render namespace (a new quiver) plays at once, is re-measured, and is replaced |
| `perform_next.spec.js` | A spare grows while B holds an offer, so NEXT is as fast as Offer; the pad reads NEXT · passes on B; a heard pass has UNDO (B back, nothing recorded) and counts after its window; an unheard pass says it was not counted |
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
| `perform_truth.spec.js` | Half-closed rings on the open side and their captions; *listening…* is never the search look and never grafts; first steps name a control that turns; choosing an XY axis gives the keys back; search controls spring back; Blend home after a pass; a drift's re-check is background; a stalled shipped-wirings fetch still lets a preset be measured; a re-check or a first measurement the engine never answers (an injected `engine_error` naming its `req`, the engine slowed fourfold so it is still out) is let go, the status saying it couldn't re-check or measure the patch instead of *re-checking* or *listening…*; after a crash (the engine poisoned, every request answered with a fatal `engine_error`) no spare is asked for by itself and a pressed Offer is not sent, B saying the engine crashed; an offer whose walk crashed the engine says so in B even when its own empty reply came before the crash (a worker from before the worker answered a trap with the crash alone, which `apps/web/tests/worker-perform-replies.test.mjs` pins); a module the engine fails to add (an injected non-fatal `engine_error` for `perform_graft`) is said to have failed and grows no offer in its place |
| `patch_truth.spec.js` | An unplugged socket goes quiet and reads EMPTY; a knob turned in PATCH keeps its value with no ghost, and PERFORM plays from it |
| `patch_audible.spec.js` | Measured at the output: a VCO's wave cycled in PATCH has each wave's harmonics under a held note and on ▶ and Space; a selector changed under a held note keeps its level while the engine renders it (nothing reaches the voices before the reply) and plays at its measured makeup once it lands; a knob whose check finds a runaway is muted, as the alarm says, until a check passes; a selector whose check fails is not applied and the alarm says so, and a knob turned after it is not muted for it; an edit's reply leaves alone the makeup of a preset opened from memory while the edit rendered; an undo and a redo of a selector reach the voices at their measured makeup, so a held note's level holds while they render; a cutoff turned down lowers the centroid live and on ▶; ▶ or Space pressed while the edit is still at the engine plays the edit, not the sound before it; Space in PERFORM and EVOLVE plays the edited sound, waiting for an edit the same way, and the sound in hand in the menu bar says it waits within 100 ms; that waiting ▶ is lit within 100 ms, and a second press, Space, another ▶ or leaving PATCH takes it back; Space with ▶ disabled says why and plays nothing |
| `audio_in.spec.js` | AUDIO IN, with the browser's inputs stubbed (tones per fake device, never a microphone): the browser is asked only when AUDIO IN is added, and says what for while it asks; a refusal keeps the module, silent, with ASK AGAIN; each device opens once and fans out to every module reading it (and the input menu reuses it); a tone in is heard at the output with no key down once MONITOR is on and not at all while it is off (a key held or not), monitoring is off after a reload and a sound that listens opens its input without a prompt; the first listen captures a clip the engine takes, NEW CLIP another; a restore that installs a captured clip re-sends the farm's phrase, and (`@slow`) a capture re-sends it to a crew standing; an unplug silences the module and says so, a replug plays again; the browser's `default` is numbered as the input it stands for when only the list's "Default - X" names it; the square draws the input's live face while it plays and nothing, level included, once it is unplugged |
| `audio_in_takes.spec.js` | TRACK and CAPTURE, on the same stub (`audio_in_stub.js`): both in the module rail, and placing TRACK asks for an input; a tracked sound monitored plays from the input with one voice, and keys over it sound as voices of the tracked note (held, the output's RMS sits within −3 to +11 dB of the tracked voice's: four voices at one pitch sum by phase, so the 440 Hz bin can't carry a band) and stop with their keys (the level after they are let go is the tracked voice's alone); CAPTURE's RECORD puts a take of its input in the sound as an edit, the module says its length, and a key plays it; a STOP the worklet answers with no frames sends no take and says nothing was recorded (the worklet's own half, exactly, in `apps/web/tests/worklet-take.test.mjs`); moving to another sound while RECORD is lit stops it, and the take lands on neither sound, while a keep as new is the same sound and the take lands on it; a sound whose take couldn't be read is kept safe under *kept safe* and RECORD AGAIN brings it back into the pool, waiting for its input to open (held open by the stub) and recording that input while the bench reads another; a refused input says so and records nothing; the bank's cursor reaches a sound kept safe past the pool's last row, and Enter presses RECORD AGAIN; AUDIO IN's and CAPTURE's buttons are on the rack's keyboard walk (the arrows reach them after the knobs, a hidden one is passed by, Enter or Space presses them, Escape backs out to the plate, and the focus stays on RECORD through the redraw its take makes) |
| `patch_guess.spec.js` | The model's guess for the next module, read as the worker posts it: the top guess drawn at its socket with GUESS · ‹module›, its reason and forecast in the model's italic (and *it may not help* when its lower bound is under zero), the rail's mark beside its name without moving the name; a skip shows the next guess, not that family at that socket; adding it sends the guess with the edit; ⌘Z of an added guess counts as a skip; nothing before the warm start (`no_taste`), with no render crew raised for it; every candidate ranked on a crew, the likeliest eight with `?farm=0` and no crew asked for; a skip made after KEEP AS NEW still holds when the kept sound is opened again; a new patch's skips are not the sound's it was started from; a guess added after its socket was filled is refused with the engine's reason; a guess asked while boot's crew is still filling the pool waits for it and is then ranked on a crew, every candidate |
| `patch_cables.spec.js` | Each audio cable's light and level mark follow the levels `cable_levels` posts, one per cable, keyed `from>to` as the rack draws them; modulation cables carry neither; never more than one probe at the engine; a knob drag asks for one probe after it settles, its marks hollow until then; every paint of a new structure before its levels arrive is unlit, with hollow marks; with two sounds opened right after arriving in PATCH, every probe and guess goes out with no open on its way and at least the quiet window (`ARRIVE_MS`, 1.2 s) after arriving and after the last open landed; a PERFORM measurement nobody is waiting on (`bg`), sent just before a knob turn's probe, does not hold the probe or the cables' light back, and still finishes |
| `patch_from_nothing.spec.js` | NEW PATCH leaves one empty socket and the amp, named *New patch* and counted in its caption; modules added from the rail; a processor deleted and put back with the toast's undo; a source deleted leaves its socket empty; CLEAR and its undo; BACK TO ‹name› reopens the sound, and NEW PATCH brings the new patch back; ⌘Z past its start ends it; Esc on a plate button (CAPTURE's RECORD) backs out to its plate and keeps the new patch |
| `patch_sheet.spec.js` | On a coarse pointer, a tapped module opens a sheet with a row for every knob the engine describes (a slider with − and + of at least 44 px, or the setting's choices); + edits the knob through the lane, a choice sets a named setting and the arrows move between choices, focus goes into the sheet and leaves it with ×, a tap on another module opens that one; an AUDIO IN in the patch is drawn with its three settings, and its sheet has them; a tap on a plate button (CAPTURE's RECORD) presses it and opens no sheet |
| `patch_model_view.spec.js` | PATCH's model view (Plan-008 C2b), with a pinned fit: nothing of it at rest; held ⌥ and a tapped MODEL show the belief line in place of the subtitle, a lean edge only on the settled family's plate, one worth chip per family (two VCOs, one chip, *shared by 2*, a guess dashed), the ranking's runners-up with their lower bounds, the patch's parts in the readout and a selected module's lean over it; letting go rebuilds no plate; no "lens" in what it shows (`@slow`) |
| `patch_facts.spec.js` | PATCH's four engine facts: the face without the selected module is the worker's face for the patch with it bypassed, and the only source says *silent without it*; What goes here? sends `at` from the ⋯ and from Q, draws the ghost at that place with its place words, Esc returns to the output's guess and Enter takes exactly the ranked edit (`@slow`); a ⚡ child shows *from Reese · N changes*, its ticked modules and seed pointers as its `LineageEvent` says, gone after an edit and back after undo to as opened (`@slow`); the readout names the PERFORM controls PERFORM's measurement says turn a knob, and a module's |
| `space_after_a_click.spec.js` | A click leaves no focus on the wave or filter-mode chip, and Space then plays and leaves the chip alone (the second Space stops it); a chip reached with the keyboard cycles on Space and Enter and back with Shift, its name carrying its value and each cycle read out; in PERFORM, Space plays after a drag on a control, a click on the XY pad, and a tap on Wander (which stays frozen); the ⋯ menu's file items open their dialog on Enter and Space |
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
  `app.reply`, `ENGINE_MS`; 450 s in all at most, `ENGINE_CAP_MS`), and
  holds the engine's own replies while an
  injected one stands (`app.hold`). UI state waits the config's 10 s; a test
  has 90 s of its own; "nothing happens" is `app.quiet()` (`QUIET_MS`,
  1.5 s), the one fixed wait. `tests/web/AGENTS.md` § Writing a spec.
- **A green browser test against a stale `pkg/` proves nothing** about Rust
  changes. Check the session-start hook's warning, or `make wasm` first.
- **Timing assertions need slack** on a loaded machine (1.5 s or more), and a
  spec should accept the app being faster than when it was written.
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
