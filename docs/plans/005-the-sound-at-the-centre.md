---
title: "The sound at the centre: the views rebuilt as one space"
number: 5
status: active
author: Claude Code
created: 2026-09-30
updated: 2026-10-02
originating_proposal: 6
related_adrs: [4, 11, 12]
---

# Plan-005: The sound at the centre

## Objective

This plan implements [RFC-006](../proposals/006-the-sound-at-the-centre.md)
under [ADR-012](../decisions/012-motion-shows-what-the-engine-does.md), inside
[Plan-004](004-one-design-system.md)'s design system:

- one space around the sound in hand;
- faces everywhere;
- motion that shows only what the engine does;
- PERFORM's palette;
- PATCH editable from nothing;
- lineage in the bank;
- TASTE and LEARNING;
- touch layouts;
- a sound of your own.

Audio in, the plugin, the sonic floor (RFC-005) and the films' sound (RFC-007)
are their own proposals.

Plan-004 keeps its tasks. This plan changes what two of them target:
- **Plan-004 task 4 (specimens):** prototype v2
  (`docs/notes/vision-2026-09/prototype/`) is the approved specimen for every
  view's layout and disclosure, approved on 2026-09-30. Draft 1's five choices
  are approved as it sets them.
- **Plan-004 task 6 (the views rebuilt):** the views are rebuilt as the levels
  of one space, not as four pages.

## Bounded contexts

| Context | Owns | Files |
| --- | --- | --- |
| Shell | The levels, zoom, the rail, the header, ⌘K, the lens, the morph | `apps/web/index.html`, `main.js`, `style.css` |
| Faces | The vessel from each render, whitened against the bank | `apps/web/` (worker and drawing) |
| PERFORM | Offers, the palette, How it works, stage mode | `apps/web/perform.js`, `crates/auracle-session/src/perform.rs` |
| EVOLVE and the bank | Seeds, children, New, Compare, Replaced | `apps/web/main.js`, `crates/auracle-wasm` (`lineage()`) |
| TASTE and LEARNING | Picks as directions, the map, the model room, export | `apps/web/`, `crates/auracle-wasm`, `crates/auracle-session/src/map.rs` |
| PATCH | The module sheet, visible modulation, a patch from nothing | `apps/web/main.js` (the rack), `crates/auracle-session` |
| Engine | The belief per pick, the seed count, new directions, the module suggestion, cable levels | `crates/auracle-session`, `crates/auracle-taste`, `crates/auracle-wasm` |
| Words | The guide pages for each level, the found-along-the-way fixes | `www/docs/src/`, in-app copy |

## Tasks

1. **Tokens from the specimen.**
   - The prototype's values go into `tokens.json`, completing Plan-004 task 1:
     - type: Jost, Plex Mono and Newsreader; a 1.2 ratio; 11 px labels and a
       12 px floor;
     - spacing: 4 to 48;
     - radii, durations and easings.
   - A mark on a row (the unheard dot, a seed mark) sits in space the row
     already has, and the label never moves. This becomes a component rule.
   - *Progress (2026-10-01):* the values are in `tokens.json` and generated
     into every surface; the app's stylesheet is on them (Plan-004 task 1).
     Where the app set an element at a size the specimen gives another role
     (PERFORM's held name, its control names and pads), it keeps its size,
     marked `token-exempt:`, until task 5 rebuilds PERFORM. The filled
     primary and the raised depth are component work, for the rebuilds.
2. **The shell.**
   - The levels: LEARNING, TASTE, PERFORM and PATCH, with EVOLVE beside them.
   - Zoom by pinch, ⌥-scroll, ⌥↑ and ⌥↓, or the rail. The header names the
     level.
   - The held sound's face carries the zoom.
   - ⌘K becomes the one list, and ⌥ the lens.
   - The guide's view pages are rewritten for the levels (ADR-004).
3. **Faces.**
   - The vessel is computed from each render in the worker: 40 bands, 12
     slices, whitened against the bank's mean and spread.
   - It appears on every row, chip and card.
   - The share card is built on today's image export.
4. **EVOLVE and the bank** (this is Plan-004 task 7's explanation figure).
   - Pointing at EVOLVE POOL marks the seeds as well as the sounds that may be
     replaced. The seed count is exposed from the engine (task 9).
   - Each child buds from its seed. A refused child fades beside its seed.
   - The New group forms as children land, and the button narrates each walk
     from the per-child reason the worker already posts.
   - Bank rows show the seed and the diff from `lineage()`, with an unheard
     dot.
   - Compare shows the child walking out of its seed, the diff, both ratings,
     and plays both while both exist.
   - Replaced shows names only.
   - Each animation names its engine source (ADR-012).
   - *Progress (2026-10-01):* built in today's bank, before the shell and
     faces (tasks 2 and 3), so the bud and Compare draw names and phrases
     where the specimen draws faces:
     - the marks read `ratings.seeds` and `ratings.may_replace` at rest, and
       the generation's own seeds and `retiring` while it runs;
     - each walk's seed rides on `refine_child` (the job's `parent_id`, the
       one worker addition), so a refused child fades beside its seed;
     - the bank's rows keep a mark column left of the name, which NEW and the
       unheard dot share.

     Where the specimen and the engine differ, the engine was followed:
     - seeds are the top `refine_seeds` (ten), not a quarter of the pool;
     - a child is admitted against the weakest member it would displace with
       what is already owed counted (the specimen's `floor[owed]` agrees);
     - a duplicate or an unmoved walk breeds no child, so nothing fades for
       it;
     - the button says "joined the pool" where the specimen says "kept"
       (the word table keeps "keep" for PERFORM's pad);
     - the specimen pictures a child as its seed after a short walk, knobs
       nudged and now and then a module swapped; the engine's 40-step walk
       changed 26 sites in one child of a review run, so Compare lists every
       change and its list scrolls;
     - the specimen breeds one walk at a time; on the farm the last walks
       are absorbed within milliseconds of each other, so their buds fly
       together, as the generation's end is said.
5. **PERFORM.**
   - The offer grows from the sound in hand, is filled when taken and folds
     back when passed. The heard rule is unchanged.
   - How it works covers every control.
   - The palette UI (place, hide, order, up to eight, persisted) is built over
     today's six controls. The rest arrive with task 9.
   - Stage mode (⇧F).
   - *Done (2026-10-01), in today's PERFORM layout:* the palette's panel over
     all eighteen (task 9c), placed, hidden and ordered, at most eight, saved
     with the session as `perf.panel`. A measurement asks for the panel's
     set in palette order, the page names each control back by its `index`,
     and `wireKey` holds the set. A placed control is measured lazily and
     says *listening…* while it is. How it works covers every placed control.
     B grows from the sound's name, fills when taken and folds back when
     passed (each motion names its engine source); the heard rule is
     unchanged (an unheard take is allowed and records no pick). Stage mode
     draws the output's spectrum for now: stage draws the face once task 3
     lands (`stageDraw` in `perform.js` is the one function to swap, marked
     `faces:`). Not done: the faces the prototype draws (the well, a face in
     stage mode) wait for task 3, so the offer's motion anchors on the
     sound's name; the palette's preview of
     an unplaced control needs the unverified wiring exposed (the reference's
     PERFORM page, "What is not done"); the prototype's well-and-panel layout
     waits for the shell (task 2). Where the prototype and the engine
     disagree, the engine's words stand: Body is "thin · full" (the
     prototype says "thin · heavy"). Stage mode lights no note bands, unlike
     the prototype: no note timings reach `perform.js`. ⇧F opens stage mode
     in PERFORM only (ADR-009's note).
6. **TASTE and LEARNING.**
   - A pick draws as an arrow from the sound passed to the sound kept, and
     every glow moves together.
   - A refit settles every glow at once.
   - Per-pick glows wait for task 9's belief.
   - LEARNING shows the weights, the direction, the scored forecasts, the
     export as JSON, and the maths (18 audio and 26 structural features, 500
     draws, the lenses).
7. **PATCH.**
   - On touch, a tapped module opens a sheet with every setting.
   - Cables carry light by signal. Measured levels at rest come from task
     9(e)'s probe (`cable_levels`); the live meter covers sounding notes.
   - A new patch starts empty: remove a module with undo, clear it, skip a
     guess. The guess itself is task 9(d), built; this task draws it and
     raises a render crew for it.
   - *Progress (2026-10-02):* built in today's rack, in its own module
     (`apps/web/patch.js`, reached from main.js through a host), before the
     shell (task 2) rebuilds the view to the specimen's layout:
     - **the module sheet:** on a coarse pointer, a tap on a module (or one of
       its knobs) opens the specimen's sheet with every knob the engine
       describes: a wide slider with − and + (held, they repeat) for each
       continuous one, the choices of each named one, REMOVE MODULE at its
       foot. It writes through `sendEdit` and the ordered lane, holding
       `knobDragging` while a finger is down;
     - **cables by measured level:** the workbench's audio cables at rest
       carry the level `cable_levels` measured (−54 to 0 dB re 1 V, the
       meter's mapping), with the specimen's level mark on each, asked once
       an edit settles while PATCH is shown; a structure not yet measured is
       unlit with hollow marks. Modulation cables are not measured: unlit, no
       mark, still pulsing at their modulator's rate as set (`modBreath`);
     - **from nothing:** NEW PATCH (one `edit_set_tree`: the root becomes an
       empty `Silence` socket, the amp is kept), CLEAR and BACK TO ‹name›
       (Esc), each with an undo; deleting a source now leaves its socket
       empty (it was refused), so a patch goes back to nothing a module at a
       time;
     - **the guess:** GUESS · REVERB over the rack with its reason in the
       model's italic and its forecast, the module dashed amber at its socket,
       added (`edit_structure` with `guess`) or skipped (`guess_skip`); the
       rail marks the guessed kind in the row's own padding. The worker
       renders the candidates on a walk crew (`farm_render`, `memo_absorb`)
       without holding the floor, and the floor of eight on its own thread
       with none;
     - **the guess's memory** is keyed by its own id (`guess_key`), moved by
       keep as new, so skips made after the commit stay with the kept sound.

     Where the specimen and the engine (or the specimen and today's rack)
     differ, the engine was followed:
     - the specimen's PATCH is a canvas signal flow with the face at OUT, the
       catalogue at the well's left and a "How to read this" legend. That
       layout is task 2's rebuild; here the catalogue is the module rail, and
       the guess hangs at its socket (above the cable, over the empty socket,
       under the slot) rather than being laid into the chain;
     - the specimen estimates a new patch's face from its modules' kinds and
       knobs ("estimated"), and dashes the face without a module under the
       pointer; the sheet carries the same estimate. These are estimates the
       engine does not make, so none is drawn (ADR-012); faces are task 3's.
       The guess's own "estimated vessel" can be measured instead: each
       candidate is rendered for the ranking (keyed in the engine's memo by
       `GuessCandidate::key`), so once faces land (#102) and can be taken
       from that render or kept beside its row, the guess
       plate gets the candidate's face, labelled as the patch with this
       module, beside the patch's own. patch.js calls `host.guessFace(g,
       at, layer)` for it; main.js does not provide it yet;
     - the specimen's "in 39% of similar presets" counted presets; the
       engine's guess is ranked by the posterior, so the line is the
       model's reason and forecast, and says *it may not help* when the lower
       bound is under zero;
     - the specimen's "Build a synth / Process a sound" first step needs
       AUDIO IN in the module rail (another branch's): a new patch opens
       straight onto its empty socket;
     - the specimen's AUDIO IN plate chooses a device and one of four uses
       (process, modulate, play, resample) and draws a shared input fanning
       out. The engine's `AudioIn` has an input slot, a gain and a channel,
       and only processing exists, so PATCH draws and edits those three;
     - the specimen's light points travelling along each cable while it
       plays: the rack's flow while notes sound (the live meter) stands for
       it;
     - the specimen's toasts ("Removed reverb.") keep the rack's own receipts
       (*Reverb deleted and set aside below.*), whose undo puts it back;
     - the specimen's turned-knob bar (Compare, Keep, Revert) is the rack's
       KEEP AS NEW and ⌘Z;
     - a phone still meets the handheld gate: the sheet is the specimen's
       phone sheet below 701 px, but laying PATCH out for a phone is task 8.
8. **Touch.**
   - A phone gets its own layout: a bottom bar, the bank and the palette as
     sheets, the keys as a drawer, swipe to keep.
   - Each view's scroll is measured on a phone and a small phone, as in the
     prototype's review.
9. **Engine,** each item with its own measurement before it lands:
   - (a) The belief after each pick, posted to the app. Measure its cost
     first (RFC-006, Open 3).
   - (b) The seed count, exposed (`refine_seeds`).
   - (c) The palette's twelve new directions. Define each in φ and measure
     how often each is reachable across the presets. *Done (2026-10-01):*
     `PALETTE` in `perform.rs`, measured over the 62 presets
     ([Measured (task 9c)](#measured-task-9c)). The worker's `perform_wire`
     takes `controls`, the palette indices to wire; the page sends none yet,
     so it wires the six as before.
   - (d) The module suggestion: a design note first (Open 2). The note is
     [`docs/notes/suggest-2026-10/`](../notes/suggest-2026-10/README.md).
     *Done (2026-10-01), engine and wasm side:* the model's guess, as the
     maintainer decided it (`guess.rs` in `auracle-session`; the bindings
     `guess_plan`, `guess_rank`, `guess_skip`, `guess_take`; the worker's
     `guess` and `guess_skip`, with no crew yet)
     ([Measured (task 9d)](#measured-task-9d)). PATCH draws it, and the
     worker renders it on a crew, since task 7 (2026-10-02).
   - (e) A cable-level probe. *Done (2026-10-01):* `probe_cables` in
     `auracle-features`, `edit_cable_levels` in wasm, the worker's
     `cable_levels` ([Measured (task 9e)](#measured-task-9e)).
   - (f) Keeping a generation's replaced trees until the next one (Open 1).
     Done only if the maintainer decides to keep them.
10. **Explain anything.** Each control gets a figure, and the first lesson
    ("what a filter does") uses the sound in hand.
11. **A sound of your own.**
    - φ is computed from a decoded file (`auracle-features`, a wasm binding).
    - The sound takes its place on the map, and its nearest sounds are shown.
    - Breeding toward it uses walks tilted toward its φ, as aimed offers are.
    - *Progress (2026-10-02): the engine and the worker are built; the card is
      not.* `featurize_file` measures a decoded file as a render is measured
      (trim, resample, the same normalization and `audio_features`). By
      measurement (`file_phi`), a recording measures 5 of φ's 44 coordinates,
      its spectral balance; the rest are masked (`FILE_MASKED` and every
      structural one). Its nearest pool members and presets are ranked over
      those five, it is placed on TASTE's map by the map's own projection
      (`TasteMap::own`), and `refine_toward_jobs` breeds a generation toward
      it on the taste's target times a floored Gaussian likelihood of the
      recording (`OWN_GAMMA` 4, `OWN_FLOOR` 25). The session saves it as its
      five coordinates, by name, never the audio. Bindings: `own_sound_set`,
      `own_sound`, `own_sound_clear`, `own_presets_set`,
      `refine_toward_jobs`; the worker answers `own_sound_set`, `own_sound`,
      `own_sound_clear` and `refine` with `toward: true`, and main sends none
      yet. The measurements, and where the engine and the prototype differ,
      are in the reference
      ([A sound of your own](../../www/reference/src/features/own-sound.md)).
      Breeding needs a fitted taste, as EVOLVE POOL does; Hold it is audio
      in (RFC-008).
    - *Decided for the card (maintainer, 2026-10-02):*
      - **Before the first fit**, Breed toward it adds the nearest presets
        (`own_nearest_presets`, then `load_preset`), as the prototype does.
        That is true, since it is adding presets, and needs no taste. After
        the first fit it is the tilted generation (`refine` with
        `toward: true`).
      - **Playback:** the page keeps the decoded audio in IndexedDB, so the
        recording plays after a reload and sits in the bank as the
        prototype shows. It stays out of duels; the engine keeps only its
        measurement.
      - **Hold it** plays the recording through the named controls once
        audio in is live: the UI stream's work, with Plan-007.
      - **Buds** show the children growing from their parents, the pool
        members nearest the sound, and leaning toward the recording, never
        out of the dropped face (ADR-012).
12. **Found along the way** (RFC-006), each a small change with its check:
    - the guide's "crossover";
    - the `not_admitted` text;
    - the "no move was accepted" toast;
    - a ⚡ child's New tag;
    - Space in PERFORM and EVOLVE playing the edited patch;
    - Space after a chip;
    - selector changes reaching held notes.

## Measured (task 9a)

`crates/auracle-wasm/examples/pick_belief.rs` (native) and
`pick_belief.mjs` beside it (the built package under node, V8): the app's
pool of 40, a refit every sixth pick, 100 picks decided by the model's own
forecast and a seeded coin, on an Apple M3 Max. Medians in ms, wasm:

| Lenses (picks) | The reweight | `belief` at rest | `belief`, generation open (pool 49 of 40) | Ranked list | Whole map | Refit |
| --- | --- | --- | --- | --- | --- | --- |
| 2 (25–42) | 0.21 | 0.74 | 1.80 | 0.83 | 4.2 | 0.36 s |
| 5 (85–100) | 0.35 | 1.64 | 3.91 | 1.71 | 28.0 | 1.07 s |

wasm runs it 1.2 to 1.3 times slower than native. The first cut took its
numbers from the calls that already existed and cost 7.9 ms native at five
lenses; one pass over the draws per member brought it to 1.34.

Decisions: every reply to a pick carries the ratings (`WasmEngine::belief`,
posted as `ratings`), as does every views post. The whole map is not posted
per pick: its history ghosts and projection cost 28 ms by 100 picks and grow
with the history, so they wait for a refit. Task 9b exposes the seed ids
rather than the count: `seeds` and `may_replace` ride in the same field.

## Measured (task 9c)

`crates/auracle-wasm/examples/palette_census.rs` wires each control on each
of the 62 presets the way PERFORM does (the shipped engine, `load_preset`,
`Engine::wire_named`: the Jacobian, at most four knobs, the purity and reach
gate, separation, verification on real renders). `palette_cost.mjs` beside it
times the same measurement in wasm. The definitions, the three redundancy
measures and the per-control tables are in the reference
([The palette](../../www/reference/src/search/perform.md#the-palette-eighteen-directions)).

| Family | Control (low · high) | Reaches alone | Beside the six |
| --- | --- | --- | --- |
| Tone | Bright, Warmth (cold · warm), Air (closed · airy) | 79%, 73%, 66% | 79%, 52%, 48% |
| Weight | Body, Thump (light · thumping), Heft (slight · heavy) | 53%, 81%, 76% | 32%, 40%, 52% |
| Dynamics | Snap, Punch (gentle · punchy), Round (hard · round) | 82%, 73%, 82% | 82%, 60%, 44% |
| Movement | Motion, Throb (steady · throbbing), Sway (fixed · swaying) | 77%, 47%, 55% | 74%, 29%, 34% |
| Space | Space, Distance (near · distant), Haze (clear · hazy) | 23%, 94%, 90% | 23%, 39%, 63% |
| Character | Grit, Bite (mild · biting), Lo-fi (clean · worn) | 11%, 81%, 56% | 6%, 58%, 34% |

"Beside the six" wires the control after the six, so where its gesture on a
patch is one of theirs it is a search control. A measurement of all eighteen
is a median 49 renders against 25 for the six (mean 49.8 against 26.2); the
Jacobian's 12 are shared, and each control that reaches adds about five. In
wasm (`palette_cost.mjs`, every fourth preset) the eighteen take a mean
14.2 s against 7.5 s for the six.

Decisions:
- The prototype's blends of the six are not used: five pairs were one
  direction. Each of the twelve is its own direction over φ.
- The twelfth control is Heft, in Weight. Round, Throb and Sway replace the
  prototype's Softness, Wobble and Drift (the voice's word table defines
  round; Wobble Board is a preset; drift is WANDER's). The maintainer
  approved the four names and their end words on 2026-10-01. Each new word
  gets its row in `www/brand/voice.md` with the palette's panel, when the
  app first shows it.
- The engine wires the six unless the worker names others (`controls` on
  `perform_wire`), so the app is unchanged. The palette's panel (task 5)
  sends the controls placed on it, and names each one back by the wiring's
  `index`, not its position in the reply. It keys its wiring cache by the
  set as well as the patch. Verifying at most eight keeps a measurement near
  today's, and the other controls' wirings come from the same Jacobian by
  prediction, without renders.
- `apps/web/perform-wirings.json` keeps the six. With the twelve it would be
  2.3 times the size (392 KB), for controls the panel does not show yet.

## Measured (task 9d)

`crates/auracle-session/examples/guess_cost.rs` (native) and `guess_cost.mjs`
in `auracle-wasm` (the built package under node): the census's session (a pool
of 40 from `shipped::boot`'s seed), each warm start (the three darkest or
brightest of the nine), and for each patch the guess the worker makes with no
crew (the first `GUESS_FLOOR`, 8) and then every candidate. CPU time, on an
Apple M3 Max shared with other jobs (load 29 to 50):

| Patch | Candidates | Renders, floor / all | Native CPU s, floor / all | wasm CPU s, floor / all |
| --- | --- | --- | --- | --- |
| Empty (Detune Dream or Sub & Sparkle, cleared) | 6 | 6 / 6 | 0.5 | 0.7 to 0.9 |
| Five presets (Sub & Sparkle, Hornet, Tine, Detune Dream, Dub Echo) | 20 to 30 | 8 / 20 to 30 | 1.2 to 1.7 / 3.3 to 5.4 | 1.6 to 2.4 / 4.7 to 7.4 |
| Deadfall, Ceiling | 30 | 8 / 30 | 3.0 to 3.4 / 11.0 to 12.3 | 3.3 to 4.2 / 12.0 to 14.5 |

One render is a median 184 ms native and 251 ms in wasm; the plan and the
ranking together cost 1 to 17 ms. The floor's first guess was all's first on
all 18 native cases and 17 of 18 in wasm. What it guesses, and why (raw):

- after the dark warm start, Hornet: *reverb at the output, it moves toward
  still (−1.98σ), as your picks lean*, 67% · leaning; Sub & Sparkle: a filter,
  toward dark (−1.06σ), 59% · leaning; Detune Dream: a mix, toward still
  (−2.31σ), 72% · fairly sure.
- after the bright warm start, the drive family leads on every preset (a
  bitcrush on Hornet, 60%, "your picks lean toward more drive"); Dub Echo's
  bitcrush and distortion both come out above zero at the lower bound; an
  empty patch's first guess is noise, toward rough (+4.06σ), 73% · fairly sure.

These reproduce the note's census lines exactly where they overlap. Found on
the way: an empty patch's reasons named its kept amp envelope; the reason now
measures from the average sound with the patch's own structure.

## Measured (task 9e)

`crates/auracle-features/examples/cable_probe.rs` over the 62 presets: a probed
render took a median 0.99 times a plain one (162 against 165 ms of CPU), and
all 62 rendered bit-identically with and without the probe.
`crates/auracle-wasm/examples/cable_cost.mjs`: a median 160 to 206 ms per probe in
wasm under node over two runs, against 183 to 238 ms for a render with φ. One render, so the probe
runs once an edit settles, in the `later` lane, not per block; the live meter
covers sounding notes.

## Done when

- The app is one space at the prototype's specimen, with the guide rewritten
  to match.
- Every animation that shows a mechanism names its engine source, and none
  draws a fact the engine doesn't record.
- The bank shows each child's seed and what changed.
- The palette carries the controls the engine can measure, and says which are
  search controls on this patch.
- Each view passes the text budget (Plan-004 task 5) and the phone scroll
  measurement.
- The found-along-the-way items are fixed or deferred with a reason.
