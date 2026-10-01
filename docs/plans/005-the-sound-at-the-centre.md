---
title: "The sound at the centre: the views rebuilt as one space"
number: 5
status: active
author: Claude Code
created: 2026-09-30
updated: 2026-10-01
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
       (the word table keeps "keep" for PERFORM's pad).
5. **PERFORM.**
   - The offer grows from the sound in hand, is filled when taken and folds
     back when passed. The heard rule is unchanged.
   - How it works covers every control.
   - The palette UI (place, hide, order, up to eight, persisted) is built over
     today's six controls. The rest arrive with task 9.
   - Stage mode (⇧F).
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
   - Cables carry light by signal. Measured levels wait for task 9.
   - A new patch starts empty: remove a module with undo, clear it, skip a
     suggestion. The suggestion itself is task 9.
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
     how often each is reachable across the presets.
   - (d) The module suggestion: a design note first (Open 2). The note is
     [`docs/notes/suggest-2026-10/`](../notes/suggest-2026-10/README.md),
     waiting on the maintainer's decision.
   - (e) A cable-level probe.
   - (f) Keeping a generation's replaced trees until the next one (Open 1).
     Done only if the maintainer decides to keep them.
10. **Explain anything.** Each control gets a figure, and the first lesson
    ("what a filter does") uses the sound in hand.
11. **A sound of your own.**
    - φ is computed from a decoded file (`auracle-features`, a wasm binding).
    - The sound takes its place on the map, and its nearest sounds are shown.
    - Breeding toward it uses walks tilted toward its φ, as aimed offers are.
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
