---
title: "Testing: every gate, what it proves, when to run it"
last_updated: 2026-09-28
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
| All tests | `make test` | The workspace, optimized; includes `shipped_preset_wirings_are_current` (the shipped preset wirings match today's presets and named inputs) and `shipped_preset_wirings_measure_the_same_today` (a sample of them re-measures the same: standardizer, φ, wiring) | Before a commit that touches Rust or a preset |
| Preset wirings | `make perform-wirings` | Regenerates `apps/web/perform-wirings.json` (minutes, natively) | A preset, the phrase, φ (features, normalization, vetting, DSP), the grammar prior or PERFORM changed (`make test` says so) |
| Everything CI runs | `make check` | fmt, lint, js, wasm32, tests | Before every commit |
| Browser smoke | `make smoke` | Boots clean, worklet registers, failure flows contained | After `make wasm` |
| Browser suite | `tests/web` specs (see its `AGENTS.md`) | Every behaviour a spec names | Any app behaviour change; CI's *Browser suite* workflow runs it on PRs touching the app, nightly and on demand (not required) |
| Site | `make site && make site-check` | The site builds; every link, asset and anchor resolves | Any `www/` change, public API docs |
| Search health | `make search-check`, `make climb`, `make islands` | The search still improves the pool | Engine search changes |
| φ | `make revalidate` (both sides, diff), then `make perform-wirings` | What the model can hear did not silently change; the shipped preset wirings are measured in the new φ | Any φ, phrase, vetting or normalization change |
| Model | `make fit-bench`, `make closed-loop` | The posterior still recovers a synthetic user | Model or budget changes |

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
| `evolve_ahead.spec.js` | A pick or ↻ puts the pair dealt ahead up at once, sounds and all; a taken-back pick restores its pair and keeps the other as the next; a patch cut while its pair waits ahead is never put up |
| `evolve_breeds_beside_you.spec.js` | EVOLVE POOL completes on the farm with children landing in job order at the top of the bank; a pick mid-generation deals within 1 s; PERFORM measures and a pressed Offer starts during a generation; stop keeps what's bred; ⚡ leaves the engine free and its stop drops it; the E and the job slot agree |
| `budgets.spec.js` | The response-time budget: the timing marks exist; a preset's controls live ≤ 1 s from its click; a warm-start pick's ≤ 1 s from *teach it*; pick → next pair ≤ 0.3 s; duel ▶ ≤ 0.15 s |
| `perform_controls.spec.js` | Half-closed controls stop at centre, XY axes, the status line |
| `perform_instant.spec.js` | With the shipped file blocked, the player's cache: a revisit wired ≤ 0.5 s, ≤ 1.5 s after a reload; a spare offer lands at once |
| `perform_next.spec.js` | A spare grows while B holds an offer, so NEXT is as fast as Offer; the pad reads NEXT · passes on B; a heard pass has UNDO (B back, nothing recorded) and counts after its window; an unheard pass says it was not counted |
| `perform_wander.spec.js` | Wander's first move ~1.5 s after it is let go in a new zone; its own drag is not a touch; zone ticks; the *ideas* zone; its caption carries its state and counts down; the status line keeps to the patch |
| `perform_recentre.spec.js` | A re-centre glides home with a fading ghost; a background re-check with the same knobs leaves a turned control where it is |
| `perform_teaches.spec.js` | An offer heard and answered is a pick; unheard, it is not |
| `perform_circuit.spec.js` | A knob turned in PERFORM is drawn performed in PATCH |
| `perform_truth.spec.js` | Half-closed rings on the open side and their captions; *listening…* is never the search look and never grafts; first steps name a control that turns; choosing an XY axis gives the keys back; search controls spring back; Blend home after a pass; a drift's re-check is background |
| `patch_truth.spec.js` | An unplugged socket goes quiet and reads EMPTY; a knob turned in PATCH keeps its value with no ghost, and PERFORM plays from it |
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
