---
title: "Testing: every gate, what it proves, when to run it"
last_updated: 2026-09-30
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
| wasm32 | `make wasm-check` | The engine compiles for the browser target | Rust in session or wasm |
| Crate tests | `cargo test -p <crate> --profile test-fast` | That crate's gates | The crate you changed |
| CI's Rust tiers | `make test-fast-tier`, `make test-slow-tier` | The workspace split the way CI splits it (needs `cargo-nextest`) | To reproduce a CI leg by name |
| All tests | `make test` | The workspace, optimized; includes `shipped_preset_wirings_are_current` (the shipped preset wirings match today's presets and named inputs) and `shipped_preset_wirings_measure_the_same_today` (a sample of them re-measures the same: standardizer, φ, wiring) | Before a commit that touches Rust or a preset |
| Preset wirings | `make perform-wirings` | Regenerates `apps/web/perform-wirings.json` (minutes, natively) | A preset, the phrase, φ (features, normalization, vetting, DSP), the grammar prior or PERFORM changed (`make test` says so) |
| Everything CI runs | `make check` | fmt, lint, js, wasm32, tests | Before every commit |
| Browser smoke | `make smoke` | Boots clean, worklet registers, failure flows contained | After `make wasm` |
| Browser suite | `make browser-fast`, `make browser-slow` (see `tests/web/AGENTS.md`) | Every behaviour a spec names | Any app behaviour change; in CI the fast tier is part of the required `CI` check and the `@slow` specs run in the *Slow suite* ([CI tiers](#ci-tiers)) |
| Site | `make site && make site-check` | The site builds; every link, asset and anchor resolves | Any `www/` change, public API docs |
| Search health | `make search-check`, `make climb`, `make islands` | The search still improves the pool | Engine search changes |
| φ | `make revalidate` (both sides, diff), then `make perform-wirings` | What the model can hear did not silently change; the shipped preset wirings are measured in the new φ | Any φ, phrase, vetting or normalization change |
| Model | `make fit-bench`, `make closed-loop` | The posterior still recovers a synthetic user | Model or budget changes |

## CI tiers

CI runs in two tiers, so that the check a PR must pass takes about five to
seven minutes instead of the twelve of the old `Test` job plus up to fifteen
of the browser suite. A PR may merge on the fast tier alone.

| Tier | Where | Runs | Gates merging |
| --- | --- | --- | --- |
| Fast | `.github/workflows/ci.yml`, the `CI` check | Lint, Web, Wasm check, Site (with `make smoke`); the Rust tests not named slow (`make test-fast-tier`, split over two runners by hash); every browser spec not tagged `@slow` (five runners, against one wasm build per run) | Yes. The branch ruleset requires `CI`, unchanged; the fast browser shards are inside it |
| Slow | `.github/workflows/slow-suite.yml`, *Slow suite* | The search floor (`make test-search-floor`); the other slow Rust tests (`make test-slow-rest`); every `@slow` browser spec (six runners) | No |

**When the slow tier runs.** On every push to `main` and nightly, in full; a
failure there opens an issue titled *Slow suite failing on main*, or comments
on the open one. On demand from the Actions tab. On a PR, when the diff
reaches what the slow tests cover, or when the PR carries the `full-ci` label
(adding it starts a run):

- the slow Rust tests run on a change to any crate, `Cargo.toml`/`Cargo.lock`,
  the `Makefile`, or the workflow and its actions. Every one of them walks the
  whole pipeline (grammar edits, rendering and φ, the taste model, the
  session), so no crate is outside what they cover;
- the `@slow` browser specs run on a change to `apps/web/worker.js`,
  `farm.js`, `perform.js` or `live-audio.js`, to `crates/auracle-session` or
  `crates/auracle-wasm`, to a spec file holding an `@slow` test, or to the
  suite's config and lockfile. Not `main.js`: every view lives there, so it
  would make nearly every app PR a slow run. A `main.js` change that reaches
  EVOLVE's generations or PERFORM's offers should carry `full-ci`; otherwise
  the push to `main` is where it is caught.

**What is slow.** Measured on PR #65's CI run at `f67cde2` (GitHub's 4-core
runners). Rust tests over a minute, named in the `Makefile` as
`SEARCH_FLOOR` and `SLOW_TESTS`:

| Test | Time |
| --- | --- |
| `auracle-session tests::refinement_improves_pool` (the search floor, a runner of its own) | 331 s |
| `auracle-session perform::tests::an_aimed_offer_moves_the_way_it_was_turned` | 184 s |
| `auracle-session perform::tests::a_planned_measurement_is_the_measurement` | 183 s |
| `auracle-session tests::a_walk_is_a_function_of_its_job` | 127 s |
| `auracle-session perform::tests::named_controls_move_the_sound_they_name` | 100 s |
| `auracle-wasm tests::evolve_from_this_on_the_farm_is_evolve_from_this` | 83 s |
| `auracle-session tests::closed_loop_learns_synthetic_taste` | 76 s |
| `auracle-session tests::closed_loop_learns_motion_rate` | 72 s |
| `auracle-session perform::tests::drift_is_local_and_follows_sigma` | 71 s |
| `auracle-wasm tests::farm_walks_breed_the_serial_generation` | 70 s |
| `auracle-session tests::a_generation_absorbed_in_any_completion_order_is_the_serial_one` | 63 s |

The fast tier's slowest Rust test is 55 s; the 262 left take ~1120 s of test
time between them, which two runners clear in about 2.5 min each after a
2 min compile.

Browser tests over 40 s, tagged `@slow`: every test in
`evolve_breeds_beside_you.spec.js` (186, 168, 56, 47 and 44 s: each breeds a
generation), `evolve_truth.spec.js`'s generation with no farm (186 s),
`perform_next.spec.js` (78 s), `perform_truth.spec.js`'s drift re-check
(72 s), all three tests in `perform_instant.spec.js` (66 and 44 s, and
the held-engine reload test, which boots twice like them),
`perform_wander.spec.js` (55 s), `perform_recentre.spec.js`'s glide home
(54 s) and `perform_teaches.spec.js` (54 s). Fourteen tests, ~18.5 min in one
worker; the other 80 take ~16.6 min, and the fast tier's five runners take
2.6–3.9 min each. The next slowest (a shipped-wirings fetch that never
answers, 38 s; the warm start's two, 36 and 32 s) stay fast.

**Exactly one tier each.** The fast tier is defined as the complement of the
slow one: `not (SEARCH_FLOOR | SLOW_TESTS)` for nextest, `--grep-invert @slow`
for Playwright. A new test is fast until someone names or tags it; a renamed
slow Rust test falls into the fast tier rather than out of both; a slow list
that matches nothing fails its leg (`--no-tests=fail`). `make test` and
`make check` still run every Rust test locally.

## What each browser spec pins

| Spec | Pins |
| --- | --- |
| `smoke.spec.js` | Clean boot, worklet registered, engine playable; the binary exports the walk surface `worker.js` calls |
| `failure_flows.spec.js` | Bad save, engine error, refused vote, profile import are contained |
| `first_run.spec.js` | The warm start keeps all 18 preferences; PERFORM's first steps tick off |
| `bank_row.spec.js` | A bank row's controls appear on approach and work |
| `evolve_feedback.spec.js` | PICKS counts at once, vote toasts replace, the dealing rule, the sixth-pick redraw, bank ▶ |
| `patch_editing.spec.js` | The bench lane: edits in order, no lost edit, knobs survive redraws, receipts; COMMIT's blind card (Esc cancels), the one-shot *my edit is better*, a commit retiring the edits' receipts |
| `taste_marks.spec.js` | A guess drawn hollow with a ? in DIRECTIONS, STYLES and the node bank; TASTE's early states count what is left |
| `taste_profile.spec.js` | Reset asks with counts, downloads first and keeps saved patches; Save says what it downloaded |
| `narrow_gate.spec.js` | The narrow-window notice at any pointer under 1000 px, not over the handheld gate or "look around anyway" |
| `keys_are_not_notes.spec.js` | A letter or digit a list, the rack or a dialog handles is not also a note or a rating |
| `evolve_truth.spec.js` | ⌘Z outside PATCH changes nothing unseen; the sixth pick is undoable; "it just learned" follows `fitted`; with no pair waiting, a skip or a slow deal is inert and says why; a cut patch is not dealt; opens are quiet unless slow; tab click then → picks; keys a list uses are not notes; with no farm (`?farm=0`) a deal during a generation names the seed it waits on |
| `evolve_ahead.spec.js` | A pick or ↻ puts the pair dealt ahead up at once, sounds and all; a taken-back pick restores its pair and keeps the other as the next, even with the next deal still out; a patch cut while its pair waits ahead is never put up; pairs go up in the order they were dealt when a pick lands while the next deal is out |
| `evolve_breeds_beside_you.spec.js` | EVOLVE POOL completes on the farm with children landing in job order at the top of the bank; a pick mid-generation deals within 1 s; GENERATIONS and the next-step chip count a generation once a child has landed, not on a pick's status; PERFORM measures and a pressed Offer starts during a generation; stop ends with what's bred, retiring only at the finish; ⚡ leaves the engine free and its stop drops it; ⚡ and EVOLVE POOL take turns, each disabled with its reason while the other runs; the E and the job slot agree |
| `budgets.spec.js` | The response-time budget: the timing marks exist; a preset's controls live ≤ 1 s from its click; a warm-start pick's ≤ 1 s from *teach it*; pick → next pair ≤ 0.3 s; duel ▶ ≤ 0.15 s |
| `perform_controls.spec.js` | Half-closed controls stop at centre, XY axes, the status line |
| `perform_open_early.spec.js` | With the engine's messages held: a Keep while a patch is still opening is refused and says why; the preset clicked last is the one opened; an open that cannot complete puts the voices back on the rack |
| `perform_instant.spec.js` | With the shipped file blocked, the player's cache: a revisit wired ≤ 0.5 s, ≤ 1.5 s after a reload, and a preset opened before wired from the click with every message to the engine held; a spare offer lands at once |
| `perform_next.spec.js` | A spare grows while B holds an offer, so NEXT is as fast as Offer; the pad reads NEXT · passes on B; a heard pass has UNDO (B back, nothing recorded) and counts after its window; an unheard pass says it was not counted |
| `perform_wander.spec.js` | Wander's first move ~1.5 s after it is let go in a new zone; its own drag is not a touch; zone ticks; the *ideas* zone; its caption carries its state and counts down; the status line keeps to the patch |
| `perform_recentre.spec.js` | A re-centre glides home with a fading ghost; a background re-check with the same knobs leaves a turned control where it is; a MIDI pot on Blend is let go when Blend comes home and takes it again from home |
| `perform_teaches.spec.js` | An offer heard and answered is a pick; unheard, it is not |
| `perform_aimed.spec.js` | A search control's offer is asked for aimed (control and way), B counts while it grows and then says how far it moved, in amber; the Offer pad's offer is not aimed |
| `perform_circuit.spec.js` | A knob turned in PERFORM is drawn performed in PATCH |
| `perform_truth.spec.js` | Half-closed rings on the open side and their captions; *listening…* is never the search look and never grafts; first steps name a control that turns; choosing an XY axis gives the keys back; search controls spring back; Blend home after a pass; a drift's re-check is background; a stalled shipped-wirings fetch still lets a preset be measured |
| `patch_truth.spec.js` | An unplugged socket goes quiet and reads EMPTY; a knob turned in PATCH keeps its value with no ghost, and PERFORM plays from it |
| `patch_audible.spec.js` | Measured at the output: a VCO's wave cycled in PATCH has each wave's harmonics under a held note and on ▶ and Space; a cutoff turned down lowers the centroid live and on ▶; ▶ or Space pressed while the edit is still at the engine plays the edit, not the sound before it |
| `responsive.spec.js` | The player is answered first while PERFORM measures; warm-start ▶; Take keeps its controls |
| `booth.spec.js` | Attract plays in PERFORM, hands over on a key, and teaches nothing |
| `film_chip.spec.js` | The menu bar's film chip |

## Rules

- **Optimized profile for Rust tests**
  ([ADR-005](../decisions/005-tests-run-optimized.md)).
- **Browser jobs take a ticket (tests two at a time), own port for a worktree**
  ([ADR-010](../decisions/010-tests-share-the-browser-recordings-do-not.md)).
- **Gate tests over mocks.** Extend the gate that covers a behaviour.
- **A green browser test against a stale `pkg/` proves nothing** about Rust
  changes. Check the session-start hook's warning, or `make wasm` first.
- **Timing assertions need slack** on a loaded machine (1.5 s or more), and a
  spec should accept the app being faster than when it was written.
