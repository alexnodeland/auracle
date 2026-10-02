---
title: "Testing: every gate, what it proves, when to run it"
last_updated: 2026-10-02
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
| Film tools | `make dev-check` (its last step) | The films' sound stays one source (`www/brand/sound.py --check`), and the film tools' own tests pass: the timeline's grammar, the film's bed and marks, the mix to the ladder (`www/video/tools/test_*.py`). The mix's tests need numpy and scipy: locally from `.venv-voice`, in CI's Web job pinned from `www/video/requirements-tools.txt` | Any change under `www/video/tools/`, `www/video/sound/` or `www/brand/sound.*` |
| wasm32 | `make wasm-check` | The engine compiles for the browser target | Rust in session or wasm |
| Crate tests | `cargo test -p <crate> --profile test-fast` | That crate's gates | The crate you changed |
| CI's Rust tiers | `make test-fast-tier`, `make test-slow-tier` | The workspace split the way CI splits it (needs `cargo-nextest`) | To reproduce a CI leg by name |
| All tests | `make test` | The workspace, optimized; includes `shipped_preset_wirings_are_current` (the shipped preset wirings match today's presets and named inputs) and `shipped_preset_wirings_measure_the_same_today` (a sample of them re-measures the same: standardizer, φ, wiring) | Before a commit that touches Rust or a preset |
| Preset wirings | `make perform-wirings` | Regenerates `apps/web/perform-wirings.json` (minutes, natively) | A preset, the phrase, φ (features, normalization, vetting, DSP), the grammar prior or PERFORM changed (`make test` says so) |
| Native and wasm agree | `cargo test -p auracle-wasm --profile test-fast --test boot_agrees`; the wasm half is `tests/web/boot_agrees.spec.js` (after `make wasm`, no page opened) | The shipped seed deals the same trees, vetting and standardizer natively and in the built wasm, both pinned to `crates/auracle-wasm/tests/boot_probe.json` | A draw from an RNG, the prior, vetting, the standardizer fit; regenerate with `UPDATE_BOOT_PROBE=1` and owe what a moved pool owes. No Rust test fails without the `gen_index` fix on a target CI runs (CI's hosts are 64-bit, where it changes nothing), so the spec is the only regression guard against a width-dependent draw |
| Everything CI runs | `make check` | fmt, lint, js, wasm32, tests | Before every commit |
| Browser smoke | `make smoke` | Boots clean, worklet registers, failure flows contained | After `make wasm` |
| Browser suite | `make browser-fast`, `make browser-slow` (see `tests/web/AGENTS.md`) | Every behaviour a spec names | Any app behaviour change; in CI the fast tier is part of the required `CI` check and the `@slow` specs run in the *Slow suite* ([CI tiers](#ci-tiers)) |
| Site | `make site && make site-check` | The site builds; every link, asset and anchor resolves | Any `www/` change, public API docs |
| Search health | `make search-check`, `make climb`, `make islands` | The search still improves the pool | Engine search changes |
| φ | `make revalidate` (both sides, diff), then `make perform-wirings`, then `cargo run -p auracle-features --example file_phi --release` | What the model can hear did not silently change; the shipped preset wirings are measured in the new φ; `FILE_MASKED` still names what a recording cannot measure (the mask gate test fails until it does) | Any φ, phrase, vetting or normalization change |
| Model | `make fit-bench`, `make closed-loop` | The posterior still recovers a synthetic user | Model or budget changes |

## CI tiers

CI runs in two tiers, so that the check a PR must pass takes about five to
seven minutes instead of the twelve of the old `Test` job plus up to fifteen
of the browser suite. A PR may merge on the fast tier alone.

| Tier | Where | Runs | Gates merging |
| --- | --- | --- | --- |
| Fast | `.github/workflows/ci.yml`, the `CI` check | The voice check (in *What changed*, on every PR); Lint, Web, Wasm check, Site (with `make smoke`); the Rust tests not named slow (`make test-fast-tier`, split over two runners by hash); every browser spec not tagged `@slow` (five runners, against one wasm build per run) | Yes. The branch ruleset requires `CI`, unchanged; the fast browser shards are inside it |
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
  `farm.js`, `perform.js`, `patch.js`, `live-audio.js` or `explain.js`, to `crates/auracle-session` or
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
| `auracle-session perform::tests::a_planned_measurement_is_the_measurement` | 183 s (before its palette case, which adds a third measurement; it now fits its standardizer once rather than six times, which more than pays for it) |
| `auracle-session tests::a_walk_is_a_function_of_its_job` | 127 s |
| `auracle-session perform::tests::named_controls_move_the_sound_they_name` | 100 s (before it held the palette's twelve too; its four presets now run in parallel, 34 s on a 16-core M3 Max) |
| `auracle-wasm tests::evolve_from_this_on_the_farm_is_evolve_from_this` | 83 s |
| `auracle-session tests::closed_loop_learns_synthetic_taste` | 76 s |
| `auracle-session tests::closed_loop_learns_motion_rate` | 72 s |
| `auracle-session perform::tests::drift_is_local_and_follows_sigma` | 71 s |
| `auracle-session perform::tests::a_stepped_walk_is_the_walk` | 41 s on a 16-core M3 Max (a preset, two seeds, three kinds of walk, each stepped two ways beside the one call), not yet timed on CI; `auracle-wasm tests::a_stepped_offer_gives_the_reply_the_one_call_gives` (27 s there) stays in the fast tier |
| `auracle-wasm tests::farm_walks_breed_the_serial_generation` | 70 s |
| `auracle-session tests::a_generation_absorbed_in_any_completion_order_is_the_serial_one` | 63 s |

The fast tier's slowest Rust test is 55 s; the 262 left take ~1120 s of test
time between them, which two runners clear in about 2.5 min each after a
2 min compile.

Browser tests over 40 s, tagged `@slow`: every test in
`evolve_breeds_beside_you.spec.js` (186, 168, 56, 47 and 44 s: each breeds a
generation), `evolve_from_new.spec.js` (20 s measured on a 16-core M3 Max,
not yet on CI: six picks, a refit and a ⚡ walk, the walk alone about 23 s on a
quiet four-core machine), `bank_lineage.spec.js`'s five that breed (16, 35, 24, 26 and
22 s on a 16-core M3 Max, not yet on CI: six picks, a refit, and a
generation stopped early, after its first walk or its third, or one ⚡
walk),
`evolve_truth.spec.js`'s generation with no farm (186 s),
`perform_next.spec.js` (78 s), `perform_truth.spec.js`'s drift re-check
(72 s), all five tests in `perform_instant.spec.js` (66 and 44 s; the
held-engine reload test, which boots twice like them; the reload-at-once
test, which boots three times: 14-20 s on a 16-core M3 Max, not yet on CI;
and the kept wiring from another build, a boot and one background
measurement: 14 s on a loaded 16-core M3 Max, not yet on CI),
`perform_wander.spec.js` (55 s), `perform_offer_latency.spec.js` (a boot, a
measurement and a minute: not yet timed on CI), `perform_recentre.spec.js`'s glide home
(54 s), `perform_teaches.spec.js` (54 s), three that wait on PERFORM's
engine work, not yet timed on CI: `perform_palette.spec.js`'s measured
control (two measurements, 22 to 25 s on a 16-core M3 Max), its naming by
index and its marks (a measurement each: 13 to 16 and 13 to 15 s there),
and both tests in `perform_offer_moments.spec.js` (offers grown, heard and
answered: 17 to 19 and 31 s there), and `patch_guess.spec.js`'s five that
fit after the warm start before PATCH guesses (the guess drawn, added,
skipped and undone; the floor with no crew; keep as new; a new patch's own
skips; a stale take: 15 to
25 s each on a 16-core M3 Max, not yet on CI, where the warm start, a fit and
a render crew's spawn come first), and `audio_in.spec.js`'s capture handed
to a standing crew (28 s on a 16-core M3 Max, not yet on CI: six picks, a
refit and a ⚡ walk to raise the crew, then a capture), and
`explain.spec.js`'s eighteen figures (the panel arranged twice, each set
measured, and a figure asked of each control: 31 s on a 16-core M3 Max, not
yet on CI). Thirty tests, ~21 min in one worker; the other 87 took ~16.6 min
when last timed (at 80), and the fast tier's five runners take 2.6–3.9 min
each. The next slowest (a shipped-wirings fetch that never
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
| `smoke.spec.js` | Clean boot, worklet registered, engine playable; the binary exports the walk surface, the `belief` call and the face calls `worker.js` calls |
| `boot_agrees.spec.js` | The built wasm's `boot_probe` (the shipped seed's first 400 trees, a small pool and its first duels) equals what native `shipped::boot_probe` pins in `boot_probe.json`; opens no page, about 3 s under Node |
| `failure_flows.spec.js` | Bad save, engine error, refused vote (and no ratings posted for it), profile import are contained |
| `first_run.spec.js` | The warm start keeps all 18 preferences; PERFORM's first steps tick off |
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
| `bank_lineage.spec.js` | Pointing at EVOLVE POOL marks the seeds and what may be replaced from the engine's `ratings`, and during a generation its own seeds (posted with its progress, checked against each walk's `seed`) and `retiring` as *will be replaced*; no mark (the unheard dot, NEW, seed, may be replaced) moves or narrows a row's name, measured; the unheard dot survives a reload and clears when heard; Compare shows a child beside its seed, the diff and both ratings, and plays both while both exist; a refused child buds beside its seed and is gone, and EVOLVE POOL names each walk's outcome; a generation's children land in New with their seed and what changed, and Replaced lists only the names its end replaced; Compare lists every change and scrolls, and opens with c from the bank; while ⚡ walks, its seed and the sound its child would replace are marked, and that is what it replaces; a ⚡ child that replaced nothing leaves Replaced as it was; the name's place and each mark word's fit are measured at 1440 and 1080 px; GENERATIONS counts a generation from its first child with no pick since it opened; a sound saved mid-run loses *will be replaced* and the one that will go instead gains it |
| `faces.spec.js` | A face lands on every row, EVOLVE card, PATCH's header and teach strip, PERFORM's sound in hand and its offer (the offer's its own), and the warm start's cards; a cut redraws the bank's faces against the bank as it is now; a row's name has the same x and width with and without its face, uncut, on a desktop and a phone; the sound's card downloads at 1200 × 630 with its face, its name and its patch inside (PNG and SVG); after a reload every row draws the same face |
| `budgets.spec.js` | The response-time budget: the timing marks exist; a preset's controls live ≤ 1 s from its click; a warm-start pick's ≤ 1 s from *teach it*; pick → next pair ≤ 0.3 s; duel ▶ ≤ 0.15 s |
| `perform_controls.spec.js` | Half-closed controls stop at centre, XY axes, the status line |
| `perform_open_early.spec.js` | With the engine's messages held: a Keep while a patch is still opening is refused and says why; the preset clicked last is the one opened; an open that cannot complete puts the voices back on the rack |
| `perform_instant.spec.js` | With the shipped file blocked, the player's cache: a revisit wired ≤ 0.5 s, ≤ 1.5 s after a reload (from the cache, not measured again), and a preset opened before wired from the click with every message to the engine held; a preset opened, or a patch measured, just before a reload is remembered after it (both caches are written as the page is left); a spare offer lands at once; a kept wiring stamped by a build before the render namespace (a new quiver) plays at once, is re-measured, and is replaced |
| `perform_next.spec.js` | A spare grows while B holds an offer, so NEXT is as fast as Offer; the pad reads NEXT · passes on B; a heard pass has UNDO (B back, nothing recorded) and counts after its window; an unheard pass says it was not counted |
| `perform_wander.spec.js` | Wander's first move ~1.5 s after it is let go in a new zone; its own drag is not a touch; zone ticks; the *ideas* zone; its caption carries its state and counts down; the status line keeps to the patch; its tooltip and how it works say a tap freezes it |
| `perform_recentre.spec.js` | A re-centre glides home with a fading ghost; a background re-check with the same knobs leaves a turned control where it is; a MIDI pot on Blend is let go when Blend comes home and takes it again from home |
| `perform_teaches.spec.js` | An offer heard and answered is a pick; unheard, it is not |
| `perform_offer_latency.spec.js` | With a very long spare offer growing, a pick (`perform_record`) is answered within max(2 s, twice a measured step) and a Keep says so within max(4 s, six steps), the spare still growing (the page's CPU is throttled 4x, which need not reach the engine worker, so the bounds rest on the measured step); leaving the patch (`retire`) stops the running walk, answered `retired` |
| `perform_palette.spec.js` | The palette places, hides and orders up to eight controls, and the panel comes back after a reload; a placed control is measured with the panel's set (asked in palette order), keyed by that set, and says *listening…* until it is; each knob wears its own control's wiring and an aimed offer names its control by palette index on a panel in another order; HOW IT WORKS lists every placed control and opens on the one last touched; a row's mark never moves its name |
| `perform_offer_moments.spec.js` | B grows from the sound's name, a taken B fills and goes into the name, a passed B folds back into it (each motion's keyframes against the page); an offer taken unheard becomes the sound and records no pick (no `perform_record`), and taken heard records one |
| `perform_stage.spec.js` | ⇧F enters stage mode and ⇧F or Esc leaves; Space plays in it and it draws only while sound plays; F alone is still a note; ⇧F is stage mode in PERFORM only and the accented F in PATCH; Tab stays inside it and focus comes back on leave; a refusal said in it is in sight |
| `explain.spec.js` | Each control on the panel opens its figure (by ?, by its chip, from the switcher and the arrow keys), asked of the engine for that control on the sound in hand, and a view change puts it away; every one of the palette's eighteen opens its figure (`@slow`); a control asked about before it is measured answers once it is, a search control too; a turn with an answer open asks at most twice; Space plays with an answer open and in the lesson, after a click on their buttons too, and NEXT takes Enter only; the lesson says why a render failed (injected), draws and plays nothing for it, says when the filter goes after a sound with no room, and asks nothing more after the sound itself fails; ? is the key map's once the pointer has left a control a mouse turned, and never opens over an answer; a long press on a touch screen opens the answer and a moving finger does not (CDP touch); `EXPLAIN_CPU_THROTTLE=4` runs them at a quarter speed; a figure's sentence is built from the worker's reply (BRIGHT's center, made and turned) and follows its control when turned; the lesson on filters renders the sound in hand, its cutoff's readout is the reply's and the filtered top sits lower, and another sound gives another lesson; under reduced motion a figure is drawn whole and holds, and with motion MOTION's runs; asking moves no control's or bank row's label |
| `perform_aimed.spec.js` | A search control's offer is asked for aimed (control and way), B counts while it grows and then says how far it moved, in amber; the Offer pad's offer is not aimed |
| `perform_circuit.spec.js` | A knob turned in PERFORM is drawn performed in PATCH |
| `perform_truth.spec.js` | Half-closed rings on the open side and their captions; *listening…* is never the search look and never grafts; first steps name a control that turns; choosing an XY axis gives the keys back; search controls spring back; Blend home after a pass; a drift's re-check is background; a stalled shipped-wirings fetch still lets a preset be measured |
| `patch_truth.spec.js` | An unplugged socket goes quiet and reads EMPTY; a knob turned in PATCH keeps its value with no ghost, and PERFORM plays from it |
| `patch_audible.spec.js` | Measured at the output: a VCO's wave cycled in PATCH has each wave's harmonics under a held note and on ▶ and Space; a selector changed under a held note keeps its level while the engine renders it (nothing reaches the voices before the reply) and plays at its measured makeup once it lands; a knob whose check finds a runaway is muted, as the alarm says, until a check passes; a selector whose check fails is not applied and the alarm says so, and a knob turned after it is not muted for it; an edit's reply leaves alone the makeup of a preset opened from memory while the edit rendered; an undo and a redo of a selector reach the voices at their measured makeup, so a held note's level holds while they render; a cutoff turned down lowers the centroid live and on ▶; ▶ or Space pressed while the edit is still at the engine plays the edit, not the sound before it; Space in PERFORM and EVOLVE plays the edited sound, waiting for an edit the same way, and the dock's label says it waits within 100 ms; that waiting ▶ is lit within 100 ms, and a second press, Space, another ▶ or leaving PATCH takes it back; Space with ▶ disabled says why and plays nothing |
| `audio_in.spec.js` | AUDIO IN, with the browser's inputs stubbed (tones per fake device, never a microphone): the browser is asked only when AUDIO IN is added, and says what for while it asks; a refusal keeps the module, silent, with ASK AGAIN; each device opens once and fans out to every module reading it (and the input menu reuses it); a tone in is heard at the output with no key down once MONITOR is on and not at all while it is off (a key held or not), monitoring is off after a reload and a sound that listens opens its input without a prompt; the first listen captures a clip the engine takes, NEW CLIP another; a restore that installs a captured clip re-sends the farm's phrase, and (`@slow`) a capture re-sends it to a crew standing; an unplug silences the module and says so, a replug plays again; the browser's `default` is numbered as the input it stands for when only the list's "Default - X" names it; the square draws the input's live face while it plays and nothing, level included, once it is unplugged |
| `patch_guess.spec.js` | The model's guess for the next module, read as the worker posts it: the top guess drawn at its socket with GUESS · ‹module›, its reason and forecast in the model's italic (and *it may not help* when its lower bound is under zero), the rail's mark beside its name without moving the name; a skip shows the next guess, not that family at that socket; adding it sends the guess with the edit; ⌘Z of an added guess counts as a skip; nothing before the warm start (`no_taste`), with no render crew raised for it; every candidate ranked on a crew, the likeliest eight with `?farm=0` and no crew asked for; a skip made after KEEP AS NEW still holds when the kept sound is opened again; a new patch's skips are not the sound's it was started from; a guess added after its socket was filled is refused with the engine's reason |
| `patch_cables.spec.js` | Each audio cable's light and level mark follow the levels `cable_levels` posts, one per cable, keyed `from>to` as the rack draws them; modulation cables carry neither; never more than one probe at the engine; a knob drag asks for one probe after it settles, its marks hollow until then; every paint of a new structure before its levels arrive is unlit, with hollow marks; sounds opened right after arriving in PATCH, with the probe as slow as a CI runner's render, are not announced as having kept you waiting |
| `patch_from_nothing.spec.js` | NEW PATCH leaves one empty socket and the amp, named *New patch* and counted in its caption; modules added from the rail; a processor deleted and put back with the toast's undo; a source deleted leaves its socket empty; CLEAR and its undo; BACK TO ‹name› reopens the sound, and NEW PATCH brings the new patch back; ⌘Z past its start ends it |
| `patch_sheet.spec.js` | On a coarse pointer, a tapped module opens a sheet with a row for every knob the engine describes (a slider with − and + of at least 44 px, or the setting's choices); + edits the knob through the lane, a choice sets a named setting and the arrows move between choices, focus goes into the sheet and leaves it with ×, a tap on another module opens that one; an AUDIO IN in the patch is drawn with its three settings, and its sheet has them |
| `space_after_a_click.spec.js` | A click leaves no focus on the wave or filter-mode chip, and Space then plays and leaves the chip alone (the second Space stops it); a chip reached with the keyboard cycles on Space and Enter and back with Shift, its name carrying its value and each cycle read out; in PERFORM, Space plays after a drag on a control, a click on the XY pad, and a click on a pad; the ⋯ menu's file items open their dialog on Enter and Space |
| `midi_announced.spec.js` | A MIDI knob that claims or learns a control is announced in a sentence (*CC 74 now moves Bright, the first free control.*), the later replacing the earlier |
| `keys_for_the_platform.spec.js` | The ? card, the booth menu and the minimap's tooltip print ⌘ and ⇧ on an Apple platform and Ctrl and Shift elsewhere |
| `responsive.spec.js` | The player is answered first while PERFORM measures; warm-start ▶; Take keeps its controls |
| `booth.spec.js` | Attract plays in PERFORM, hands over on a key, and teaches nothing |
| `film_chip.spec.js` | The menu bar's film chip |
| `type_scale.spec.js` | The type scale in the browser: no text in the page under 11 px on any view or the ? card, pseudo-elements and the minimap's bookmark numbers included (the rack's SVG and a lone glyph aside); no canvas font under 12 px on the scopes and on LEARNING's forecast strip, whose labels keep their descenders inside it; the menu bar as tall as `--menubar-h` at 1440, 1000, 860 and 390 px; and `--d-press`, `--d-state` and `--d-move` all 0 under reduced motion |
| `text_fits.spec.js` | Text the type scale enlarged still fits: the warm start's cards inside a 390 and a 360 px phone's screen, and their words inside the cards; at 1000 and 1280 px every PERFORM control caption state whole (no ellipsis, no clamp, nothing past its box), with the knob row one height whatever the captions say |

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
