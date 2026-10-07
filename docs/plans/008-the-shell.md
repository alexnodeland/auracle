---
title: "The shell: one space, the levels, the rail, the model view and ⌘K"
number: 8
status: accepted
author: Claude Code
created: 2026-10-02
updated: 2026-10-06
originating_proposal: 6
related_adrs: [4, 9, 11, 12, 16, 17]
---

# Plan-008: The shell

Plan-005 task 2, in four sequential PRs. The approved specimen is
`docs/notes/vision-2026-09/prototype/` (built by `build.py`). Its 1440 × 900
screenshots are the acceptance shots: `a-perform-doors.png`, `z-desk-{perform,
patch,evolve,taste,model}.png`, `v2-rail.png`, `out-grid.png`, `a-stage*.png`,
`b-own-perform.png`, and `flow2-1024.png` for the narrow header. Line numbers
are origin/main at 819c925.

Everything the faces, lineage, PERFORM, TASTE/LEARNING, PATCH, explain and
AUDIO IN PRs built stays. The shell changes the frame around them and the way
you move between them. It does not rebuild their internals.

## Progress

Each task still to do is an issue (`docs/process.md`); the table links it.

| PR | Issue | Status |
| --- | --- | --- |
| A: the frame, the header, the level rail, the keys bar | – | merged (#112) |
| B: the bank and the model view | – | merged (#115) |
| C1: PERFORM, EVOLVE, stage mode and the guide pill (levels still switch instantly) | – | merged (#116) |
| C2a: PATCH rebuilt as the mock's canvas (head, edit bar, well, catalog, camera corner, keys, locks and ⚡, every PATCH function re-homed) | – | merged (#117) |
| C2b: PATCH's model view under ⌥ and the four engine facts | – | merged (#152) |
| Faces on the PRESETS rows; the IN POOL tag whole (C2a follow-ups) | #130 | built on `claude/preset-faces` with #153's C2b follow-ups, in review |
| C3: the zoom (`anchor()`, the morph, the puck, pinch, ⌥-scroll, `takeUp`, `d-zoom`) | #131 | merged (#331) |
| D: ⌘K, and the guide for the levels | #132 | built on `claude/shell-d`, in review |
| Explain a rank under ⌥ on EVOLVE cards and bank rows (inventory row 6) | #139 | not started |
| PATCH's specs on the shared fixture | #136 | merged (#168) |
| After the shell: the own-sound card, touch (Plan-005 tasks 11 and 8) | #133, #134 | not started |

The maintainer accepted the plan with the decisions at its end, which override
the proposals in §6 where they differ (PATCH is rebuilt to the mock's canvas,
not framed). ADR-017 records §6 Q1.

**PR A, as built, where it differs from §1–§3:**
- The levels leave the rail 96 px, not the mock's 76, with the cross 8 px
  from the edge: at 76, EVOLVE's stop (which branches left of PERFORM's) sat
  on PERFORM's FREEZE pad and the module rail's rows. Under 1080 px the cross
  draws smaller and the inset is the mock's 76. `shell_levels.spec.js` pins
  that the stops cover no control at 1000, 1080 and 1440.
- With the rail beside them, PERFORM's eight-column deck (77 px a column at
  1000) and PATCH's callout cell (208 px) cut their words, so under 1180 px
  the deck is two rows of four and the callout takes a row of its own. PR C
  replaces both layouts.
- The wordmark is set at a new app size token, `--t-wordmark` (17 px, the
  mock's).
- KEYS ⋯ is lit while HOLD, UNI, ARP or SYNC is on and names them in its
  title, and the arp chip stays on the bar while ARP or SYNC runs, so a
  keybed that plays differently still says so with its controls folded away.
  KEYS ⋯ keeps the arp drawer's rule: open through the dock's controls and
  notes, folded by a press outside the dock or Esc.
- A focused stop walks the rail with the plain arrows and Home/End, which is
  where the tab list's arrow keys went.
- The stops' names, which §1 shows on hover or focus, were built and then
  taken out at the maintainer's request (#286): pointing at the cross put
  every name over the level. Nothing is drawn beside the cross; a stop's
  name and key are its `title` (the browser's tooltip), its `aria-label` and
  its `aria-keyshortcuts`, and `#where` names the level once you are there.
- The film shots' raw `.viewtab` selectors (26 lines in six `shots.json`) and
  their keybar ids now inside KEYS ⋯ are owed with the Wave 3 re-records, as
  §3 says; `footage.mjs`'s `view` op already uses the rail.

**PR B, as built, where it differs from §1–§3:**
- **The pool's order at rest.** `Engine::ranked` sorts by posterior mean, so
  the pool used to stand in the model's order all the time. For ⌥ to reorder
  it and letting go to restore it (§4, row B), the rest of the pool (New
  keeps birth order) now stands in id order at rest, the order its sounds
  joined, under **IN THE POOL**; under the model view, once fitted, it takes
  `ranked`'s order under **RANKED BY THE MODEL**, with the FLIP glide
  (`flipBank`).
- **★ folds out the five stars.** The mock's ★ is star-4 / unstar, and an
  unstar would log a 0-star rating (`record_stars` logs every call). So ★
  opens the five existing `.star` buttons in the actions' place (a star
  pressed, the pointer leaving or Esc folds them), which keeps every rating
  reachable by pointer; 1–5 still rate the cursor row.
- **The mark column stays.** The mock's row is face then name. The origin
  glyph, NEW and the unheard dot keep their column left of the name (a mark
  never moves a name), so names start 34 px further right than the mock's.
  The seed and may-be-replaced words sit over the row's end like the
  actions, and give way to them; IN POOL did the same on a preset row,
  whose rows keep its width (since #130 it stands left of the ▶ instead). Presets drop the ▤ glyph (their tab says it).
- **Head extras.** The bank note is each tab's title, and the "what's this?"
  link went with it: the tour's `?` at the end of the find row starts at the
  tab you are on (`tourStepFor`). `#bank-count` is POOL's "+N", `#pin-budget`
  SAVED's count (amber at the cap), the budget sentence SAVED's title.
- **EVOLVE's guess before the pick** is a pill on the card it favours (*it
  guesses this · 62% · leaning*), over the top of its figure, rather than a
  line, so nothing below moves; `duel_pred` is asked with `pre: true` and
  asked again on `fitted`. The style badge keeps its place at rest, hidden.
- **The mock's veil** (an amber wash from MODEL) and the tag's flight out of
  it are not built: the LED, the tag and the amber marks say the view is up.
- **Touch.** Under a coarse pointer every bank row shows its actions, and
  every preset its ▶, at rest, on a line under the name (a tap on a row
  opens it, so hover-to-reveal would lose them); the mouse keeps the mock's
  actions on approach. ★'s stars fold on `pointerleave` for a mouse only: a
  finger "leaves" before its tap's click. `bank_touch.spec.js` pins both.
- **The film selectors PR B leaves stale**, owed with the Wave 3 re-records
  as PR A's are, in the films' `shots.json`, `gen_shots.py`, `gen_base.json`,
  `session.py` and storyboards: `.bf-n` (50, in composing, playing,
  sounddesign, tour, view-evolve, view-patch, view-perform, view-taste,
  zzprobe), `.bf[data-f]` (48: composing, tour, view-taste), `.star[data-s]`
  on rows (30: composing, view-evolve, view-taste), `.bi-pct` read at rest
  (9: tour, view-taste), `.bank-filters` (8: composing, tour, view-evolve)
  and `#pin-budget` as "n/m saved" (7: composing, view-evolve). `.pb-cat`
  appears in none. `footage.mjs`'s `preset` op and `shotgen.py` are updated.
- **The figures** `bank.webp` and `bank-row.webp` were captured from the
  bank itself (PATCH after the warm start) rather than a full
  `capture-screens.mjs` run, which PR D does; `encode-screens.sh` has the new
  rectangles.

**PR C1, as built, where it differs from §1–§3** (PR C is split into C1, C2
and C3; round 2's decisions govern PERFORM):
- **PERFORM's well and panel.** The left column is the head (the family ·
  in hand cap, the name at the display size with share, the blurb) and the
  well; the right is CONTROLS (Arrange, How it works), the status line, the
  knob grid (three to a row; four for a panel of seven or eight), the hood
  strip and the pad row WANDER · OFFER · PEEK · TAKE · PASS. Every `pf-*`
  class specs read stays on its node (`.pf-name`, `.pf-status`, `.pf-knob`,
  `.pf-pad`, `.pf-offer`, `.pf-face`, `.pf-xy-*`, `.pf-why-*`). The live
  scope survives as a small trace in the well's top left, clear of B and
  Blend, so it stays while you compare; it gives way to XY and How it works.
- **The faces in the well are face slots** (`FACE_SIZE` `well` and `wellb`,
  drawn with `FACE_OPTS`' glow and reflection and scaled by the well), not a
  canvas drawn per frame, so a face redraws only when its render or the bank
  changes (ADR-012), and B's is amber, smaller, on the held face's floor
  line. Stage mode keeps its own canvas.
- **A click on the held face plays the phrase** (Space's ▶, as the mock's
  well does, and a tap on a touch screen); a click on B does not, since B is
  heard with PEEK or B held.
- **The *vel* tick** sits in its control's top-left corner rather than under
  the name, so no word in the cell moves for it (a mark never moves a label).
- **Share** opens the existing picture panel on *the sound's card*; the
  mock's share dialog (Copy image, Copy name) is not built.
- **Freeze has no `aria-pressed`.** Wander is a slider, and ARIA does not
  allow `aria-pressed` on `role=slider`; frozen is its `aria-valuetext`
  ("frozen"), its `.held` lit ring and `data-frozen`. Enter on a focused
  Wander toggles it.
- **PASS reuses `passOffer`**, the pass Next already made before growing
  another (heard: recorded as `perform_record` with `took: false` after the
  pass window, with UNDO; unheard: *Skipped B* with UNDO). `clearOffer`
  stays the silent clear on a patch change.
- **Blend** is a native range input in the well (`makeBlend`), shown only
  while B holds an offer, kept in the page so a MIDI pot still lands; it and
  Wander keep their `knobs` slots after the panel's controls.
- **The moved bar** is shown and hidden in a slot the cap row keeps; its
  KEEP and BACK leave the tab order while the sound is home. Its printed keys
  hide under 1180 px.
- **The pad row** is one row from 1361 px; narrower, WANDER takes a line of
  its own above the four pads. At 1000 × 760 the whole right column fits
  above the keybed (`perform_layout.spec.js`).
- **How it works** is the well's third mode (the mock opens an explain
  figure from it instead; the control's figure stays on its `?`).
- **The guide pill** (`guide.js`) shows on PERFORM only, as its three steps
  are PERFORM's; C3 adds the zoom and model-view steps and decides where it
  shows then. PERFORM leaves it a row under the well. The bench, bank and
  node-bank tours are untouched (⌘K in D). Booth attract's band moved from
  the marquee row to the top of the well.
- **EVOLVE POOL dashed** means "before the first fit" (`views.styles`): a
  generation then breeds from the grammar alone, a guess (ADR-012). It is
  never disabled for it; the mock's *needs 6 picks* is not said, since the
  engine breeds with none.
- **EVOLVE's scope** keeps its canvas over the well for the *rendering…*
  sweep and *no audio for this one*, and draws no waveform; the card's style
  badge and the model view's guess sit over the well's top.
- **The toast lane** steps over PERFORM's pad row (`LANE_STRIPS`).
- **The film selectors C1 leaves stale**, owed with the Wave 3 re-records
  as A's and B's are: the KEEP, BACK and FREEZE pads, `.pf-xy*` at rest,
  `.pf-step`, `#pf-touch-*` in the touch row, `#scope-a/b`, `#promote-a/b`,
  `.lineage-strip` and `.pf-head` in `view-perform` (24 lines in
  `shots.json` and `gen_shots.py`, 2 in its storyboard), `playing` (5, and
  5 in its storyboard), `perform` (2), `view-evolve` (3, and 1),
  `sounddesign` (2) and `view-patch` (2); `capture-screens.mjs`'s PERFORM
  and EVOLVE shots (3) go with D's full re-capture.
- **Not built here:** `anchor()`, the morph and the puck (C3); PATCH's
  canvas (C2); the landing's and guide's full re-capture (D: only
  `perform.webp` and `evolve.webp` were re-captured, by hand, as PR B did
  its bank figures, from a session taught by the warm start alone: 18
  picks, no generations, Ceiling with an offer in B and no chord latched,
  not SCREENSHOTS.md's taught session; `encode-screens.sh`'s `teach-meter`
  rectangle is the old layout's).
- **The large faces have their own cache.** The well's and EVOLVE's faces
  are drawn at 2× at most and kept in `faceWellCache`, an LRU of 24, apart
  from the bank's 400 thumbnails, so their memory is bounded.
- **A pointer's turn leaves no focus.** A dial or Blend turned with the
  mouse or a finger is blurred when the turn ends (as main.js leaves no
  focus on a clicked button), so ↵ is KEEP straight after; a control reached
  with Tab keeps its focus and its Enter. The pad keys treat Blend's range
  input as a control, not a text field.
- **Touch sizes.** On a coarse pointer KEEP and BACK are 44 px tall and the
  pill's × 40 px.

**PR C2a, as built, where it differs from §1–§3 and round 2** (C2 is split
into C2a and C2b; round 2's decisions govern PATCH):
- **The canvas is the rack.** The specimen's plates are drawn by the same SVG
  renderer (`buildRack`), restyled (flat plates with a hairline edge, names in
  silk caps, knobs as travel and value arcs; no bevel or screws), so every
  hook stays on its node: `#rack-svg`, `g.mod-group[data-key]`, `[data-addr]`,
  `.knob-hit`, `.jack`, `path.wire`, `.cable-mark`, `.take-lane`, `#nb-q`,
  `.nb-item`. Every module keeps all its knobs at full detail; the compact
  level of detail is the specimen's plate (its name and setting larger, three
  knobs to read, not grab).
- **At the specimen's scale** (review round): plates re-sized so a
  four-module patch opens near 1× at 1440 px (`PLATE_W` 84–240, `KNOB_R` 11,
  `PLATE_HEAD`, `KNOB_ROW` 56, `LAYER_GAP` 56, `FIT_MAX` 1.25), the kind's
  setting in the head as its control, each knob's value then its label, a
  setting printed as its value (no chip), the amp's envelope drawn from its
  knobs (it draws the knobs, not the sound), level S-curve cables with a
  two-input module's a/b outside the plate. The setting words are the
  engine's option names (*svf lp*, *tri*), not the mock's *lowpass*,
  *triangle*. ⋯ and the lock moved to a pocket on the plate's top edge, as
  the head's right end is the setting. Compact is where a knob stops being a
  target (under 0.45×, not scaled by the frame's height); above it, where
  the readouts would not read, they are left off and names and settings
  print larger, with every knob still a control. Measured at 1440: every
  stock preset opens at 0.84–1.19× (Loom 0.69×); the ten-module pool sound a
  first visit opens at 0.51×; with the catalog open Reese fits at 0.63×; at
  1000 px Reese fits at 0.58×. (A round at 0.68× took every knob off that
  pool sound, from the mouse and the keyboard; CI caught it.) Compact keeps
  AUDIO IN's and CAPTURE's lanes (the touch sheet's buttons press them).
- **The face at OUT is `#rack-play`,** an HTML button placed over the box the
  build leaves past the amp (`placeOutFace`), not a drawing in the SVG, so it is
  the rack's ▶ itself (its wait ring, its disabled reasons, `data-hear`), and
  it is the bench's face slot (`{tree: benchTreeJson}`). The head's small face
  goes.
- **Plates are not a `listbox`.** ARIA forbids interactive children in an
  `option`, and a plate holds knobs and buttons; they stay roving-focus groups
  with a selection (`plateSel`, `.selected`), announced as they are walked.
- **Compare** is a pale pointer on each turned knob at its value as opened
  (`openedKnobs`, by node identity). `paintKnobKept`, which the inventory
  named, files PERFORM's performed value behind a knob and is not a compare.
  **Revert** is built: *undo to as opened*, one `edit_set_tree` to the bottom of
  the undo stack, settled as that many undos (`settleRestore` with `all`).
- **Colors stay the app's.** Modulation cables are dashed amber, as every mod
  tab and the catalog's port pips are; the specimen draws them green. No light
  travels along a cable at rest (ADR-012): measured levels at rest, the live
  meter while notes sound.
- **The guess and the thing in hand share the well's top line**; the pinned
  chip on the plate became that line (what happens at the socket under the
  pointer is its last words).
- **The catalog** keeps the rail's search, groups, port pips, legend, status
  line, keyboard grid, drag and click-to-arm, in-patch chips and walkthrough;
  its collapsed tab and width handle (rail chrome) go with the rail. It is not
  a phone sheet (the touch task). θ hides at rest and shows under
  `body.model-view` (C2b wires the rest of ⌥ in PATCH).
- **Leans** stays a toggle, in the layout's ▾, until C2b moves it under ⌥;
  the catalog's lean (its bars, the description's line, the keyboard card's)
  shows under the model view only. The belief line is on the well's top line,
  empty without a guess, until C2b gives it its home in the subtitle under ⌥
  (a TODO in `index.html`). The budget joins the subtitle. The scope is off
  until asked for (⋯ › Scope & analyzer…): the well's corners hold the
  camera, the readout, TEACH and the toasts.
- **The edit bar** sits on the subtitle's row, right-aligned, in a row the head
  always keeps: on the acts' row it pushed ⚡ off the line at 1000 px. The
  acts show their glyphs only under 1400 px (HOW TO READ THIS and ADD MODULE's
  key under 1600) so the name keeps the head's room; ⚡ keeps its words.
- **First steps:** the bench tour becomes PATCH's pill steps (guide.js holds
  steps per level, and × per level): *play it* first (done already for a
  player who has played, so a first visit that starts on PATCH is asked to
  play), then knob, lock, ⚡. The picks to the first refit have one home on
  PATCH, the TEACH chip, which counts them; the head's next step leaves them
  to it while a pair is dealt. The pill shows on PATCH under its well.
- **TEACH and SET ASIDE** unfold over the well's foot from their chips, so the
  well never changes height for them; the toast lane stays at the bottom right
  (stepping over the foot) rather than the specimen's centred toast.
- **Touch:** the sheet carries AUDIO IN's and CAPTURE's lane buttons (as
  buttons that press the lane's own) and the bench's face; ⋯ and ▢ show on
  every module and take a finger-sized pad.
- **AUDIO IN's fan-out** is drawn from the modules' input knobs as set, with
  nothing moving along it.
- **Not built here:** the "Start from nothing" chooser (`guess_rank` takes no
  seed, so it could not seed the guess truthfully); the model view in PATCH
  and the four engine facts (C2b); the zoom (C3); ⌘K (D).
- **The film selectors C2a leaves stale,** owed with the Wave 3 re-records as
  A's, B's and C1's are: `#spec-dock` (46 lines in 10 files), `.nb-item`
  clicked with the catalog closed (56 in 11), `#tray`/`#tray-items` (43 in
  6), `#bt-close` (13 in 3), `#lock-knobs`/`#lock-structure`/`#lock-clear`
  now in ⚡'s ▾ (16 in 3), `.seg-teach` (4), `#rack-play` now the face (8 in
  3) and `.nodebank`/`#nodebank` as a rail (22), in `composing`, `sounddesign`,
  `view-patch`, `circuit` and `SCRIPTS.md`; `capture-screens.mjs`'s PATCH and
  catalog shots (already stale since PR A's `.viewtab`) go with D's full
  re-capture, as do `play.webp`, `rack-detail.webp` and the catalog's
  `node-bank.webp` (dropped from `wiring.md`).

**PR C2b, as built, where it differs from §1–§3 and round 2** (round 2's
"⌥ in PATCH: all of it" and "Engine facts, all four"):
- **The mock draws nothing in PATCH under its lens** (`prototype/patch.js` has
  no lens code), so every mark of the model view in PATCH is new, drawn in the
  mock's language (dashed amber for a guess, the pale pointer, silk caps), and
  every one is posterior data or a measurement. Nothing new shows at rest but
  the three measurements (without this module, what a generation changed,
  PERFORM's controls).
- **The belief line** stands in for the subtitle's counts under the model
  view (the subtitle's states, the bred line, *opening…*, *1 edit waiting*,
  *N locked*, stay after it), in the model's italic at its size: *it'd like this 62% · leaning · was 58% ▲*, or its limit
  (*no guess yet: it needs a few picks first*, which C2a hid). What else the
  old line said has the readout at the well's foot as its home under the view:
  with nothing selected, the three largest parts of the utility, the style
  clause and the utility ± sd; with a module selected, a note over the line
  with its family's part of the utility (`edit_explain`, a structural
  coordinate) and the lean sentence the spec dock gave (`specParts`). The
  budget keeps C2a's rule beside it.
- **The leans toggle retired**, and nothing it did is lost: a tapped MODEL
  is remembered across a reload (`auracle-model-view`, seeded once from the
  toggle's `auracle-belief` and then retiring it), Esc ends a tapped view only
  when nothing nearer took the press (shell.js listens on the window after
  everything else and yields to `defaultPrevented`; PATCH's Esc chain marks
  what it closed), and with nothing settled the model says *no settled lean
  on anything in this patch yet*, as the toggle's toast did. The edges are
  drawn only under the view, as an overlay on the plates the build
  left (`paintRackFacts`, after every build and every repaint in place), never
  a rebuild, so letting go of ⌥ restores the canvas exactly and no knob is
  replaced under a held pointer. The overlay left `rackShapeOf` and the
  repaint fast path.
- **Worth per kind** is a column of chips at the well's top right, under its
  top line, one per family the patch holds: *filtering +0.12*, *VCOs −0.07 ±
  0.21 a guess · shared by 2*. The figure is the catalog's socket price
  (`socketPrice`, θ/scale under the bench's style), so the two never disagree;
  a family too thin to price, or before a fit, has no chip.
- **The runners-up** are chips smaller and fainter than the guess (132 × 44
  rack units), ranks 2 and 3 with *lower bound ±x.xx*: the first of their own
  place, left of the top guess (level with it, then below), above it, above
  the last one placed, or under the patch that covers no plate and no other
  guess and stays in the camera's view; if none does, their own place even
  over a plate. A faint lead goes to their place when it is not the top
  guess's. They are
  to read, not to take: the top guess is what Enter adds.
- **Without this module** is drawn for the selected module, not the one under
  the pointer (the mock's): a measurement takes a render. It is asked as a
  face the player is looking at (`seen`): the front of the faces lane, ahead
  of the bank's faces and of a PERFORM measurement nobody is waiting on, but
  after `soon` work, the rest of `later` and PERFORM's measurement of the
  sound it plays. Measured on Hornet's filter right after boot: 14.9 s before
  (behind the boot sound's demoted measurement), 2.9 s after. The patch
  measured is the structure menu's: a processor bypassed, a source's socket
  empty (set aside), a modulator unplugged, through rewrites the verbs now
  share (`bypassIn`, `emptyIn`, `unplugIn`). It stays through the selected
  module's own knobs (the patch without it is unchanged) and hides while any
  other edit has made it stale. Silent or failing the vet, the readout says
  so; the amp and an empty socket have none.
- **What goes here?** is the ⋯'s row (on a modulator, for its module's slot)
  and **Q** on a module: Q is no note key, is in no ADR's list (016, 017,
  018) and is taken nowhere in the app, and like L it acts only on a
  focused module. The top line adds where it goes (*GUESS · DELAY · AFTER
  THE MIX*) and a ✕ for a pointer or a finger; it and Esc on the ghost go
  back to the output's guess, as does any structural edit. Asked from the
  keyboard the ghost takes the focus when it lands, if the focus is still on
  the module Q was pressed on (never from a knob gone into since), and any
  redraw of the guess now keeps the focus on it (it used to drop it when a
  face landed beside it).
- **What a generation changed** prefixes the subtitle (*from Reese · 3
  changes*, counted as the bank row lists them, `bredLine`); the tick is on
  the plate's top edge at its left; the seed's pointer is the compare's
  glyph (`.knob-seed`), and the two never show together. "Unedited" is the
  bench's tree text equal to the tree as opened, which undo to as opened
  restores exactly.
- **PERFORM's controls** come from `wiredTo(addr, json)`, a reader at the end
  of perform.js's API. PERFORM measures only the sound it plays, and not while
  PATCH shows (measured: no `perform_wire` in the 8 s after a preset opened in
  PATCH), so a sound opened in PATCH says nothing of PERFORM until PERFORM has
  measured it, rather than "not measured yet".
- **C2a's follow-ups:** the armed line is one line (the price's figure and ▶
  never shrink; beside the catalog the short price, and under 1180 px the
  trace, the count and IN HAND step out); the module in hand stands clear of
  every plate, with a lead. Two faults found on the way: its fade animated
  `transform` (which on an SVG group replaces the attribute while it runs),
  and a lit socket took the pointer by its ring's stroke, which changes with
  its state (hot, previewed, dashed), so a pointer resting on the ring's edge
  entered and left it about thirty times a second, redrawing the module in
  hand each time; it now takes the pointer by its circles' boxes. (The
  caret over the socket's cable was made to take no pointer too, which
  85508ab's message credits with the fix; it was not the cause.)
- **Specs:** `patch_model_view.spec.js` and `patch_facts.spec.js` are new;
  `patch_canvas.spec.js`'s belief-line test changed meaning (the subtitle
  under ⌥, not the well's top line); `taste_marks.spec.js` reads the belief
  line under the view, `patch_canvas.spec.js`'s ⋯ list gains *what goes here*
  (mechanical); `patch_catalog.spec.js` gains the armed line and ghost test.
  No film selector goes stale: the films wait on `#belief .bl-u` being
  attached, which it still is.
- **Not here:** preset faces in the bank and the IN POOL clip (the next PR).

**The PRESETS follow-up (#130, with #153's C2b follow-ups), as built:**
- **Preset faces were already lazy on main** (`faceSlot(…, {lazy: true})`,
  `faceWhenSeen`, a preset asked by index): measured in the browser, every
  row in view got its face at 1000 px (12 of 12) and 1440 px (15 of 15),
  the first about 33 s after boot, once PERFORM's first measurement of the
  sound it opens with let go of the engine (the faces lane is below it, by
  design). What could leave one empty for good was `faceLookup`: a second
  asker for a render key already waiting (a preset row and that preset's
  pool row, or the bench) was never answered, a looked-at one could take
  the first's place, and a preset row's cancel dropped the render the
  others waited on. A `face_render` job now carries every asker.
- **IN POOL** no longer hides on approach: it stands left of the ▶'s strip
  whenever the ▶ shows (the pointer, the focus in the row, the keyboard's
  cursor, while it plays), on its own fading ground; it had been cut by the
  ▶ wherever the ▶ showed without the pointer.
- **#153:** a new patch's subtitle and sound A's go through the subtitle's
  spans; Esc's closers outside PATCH spend the press (`preventDefault`), and
  PERFORM's well modes hear Esc on the document while PERFORM shows; PATCH's
  leans, worth chips and a module's note read one θ (`benchTheta`, the
  bench's style); the guess line's ✕ sits beside its live region.
- **Specs:** `faces_presets.spec.js` and `model_view_esc.spec.js` are new;
  `bank_row.spec.js` and `patch_model_view.spec.js` gain tests;
  `patch_facts.spec.js` checks the ✕'s place; `worker-faces.test.mjs` is
  new, `worker-lanes.test.mjs` gains the preset face's place in the lanes.

**PR C3, as built, where it differs from §2.3 and §6:**
- **`.on`, not `.hidden`.** A level's section is shown by `.on`
  (`.view:not(.on)` is `display: none`), so the one being left can stay on
  screen while it fades: it is `.leaving` and `inert` until `settle`. Every
  move leaves the mark `level-landed` (`{from, to, dir, cut, flew}`), which
  `shell_zoom.spec.js` reads for where the face's flight ended.
- **Which face, and which places.** The face is the bench's render's
  (`heldFace`), none while an open or an edit is still at the engine, and a
  level's `anchor()` returns its place with the render key of the face drawn
  there: a place showing another face (PATCH hearing A or B, TASTE's mark for
  a pool sound since edited) is no place for it. EVOLVE's anchor is the card
  whose face is the sound's (opened with ↓ patch and unedited) rather than
  always null, as the plan had it; TASTE's is where the map puts the mark
  (its `taste_map` place, where a settle will leave it), LEARNING's its ring.
  Where one end has no place, the face fades in where it lands or fades out
  drifting the way you went, rather than flying from or to a spot made up
  (the mock flew it in from beside the destination).
- **Rapid moves.** A level key, a stop or a link lands the move in flight
  and starts the next at once; a step of the wheel or a pinch while one is
  in flight moves nothing, as the mock's `zoom` has it. The mock's wheel "lockout" (`lastT = now + 500`) only
  delayed the count's reset; the app's is one: 500 ms after a move, the
  rest of the turn moves nothing (`wheelStep`).
- **⌥ and the wheel over a scroller.** §2.3 has ⌥ and the wheel anywhere on
  `.stage`; review found that took the scroll from PATCH's catalog,
  PERFORM's hood and a level taller than the window while ⌥ held the model
  view up, and dropped the view. A turn that starts over something that
  can still scroll that way (not the rack, Q9) is that scroller's to its
  end (`wheelOwner`), and the view stays; any other turn is the levels'.
- **The rack.** ctrl and the wheel over `#rack-scroll` are its camera's
  (Q9), and ⌥ and the wheel over it, which used to pan it, move a level.
  The rack has no touch pinch of its own; two fingers that start on it move
  no level, leaving the gesture to it. Elsewhere on the stage ctrl and the
  wheel move a level, so the browser's ctrl-wheel and pinch page zoom no
  longer work over the stage (⌘+ and ⌘− do, as does either over the bank,
  the menu bar and the keys); `.stage` is `touch-action: pan-x pan-y`.
- **The rail.** The puck travels the stops (`railPath`) while the current
  stop is unlit (`.traveling`); during a pinch it leans toward the level
  the fingers would reach (the mock leaned the phone bar's line, which the
  desktop cross does not have). A level key at the end of the axis nods the
  rail too, not only a gesture.
- **`takeUp`** is armed by a bank row's open (click, Enter, a preset) and
  flies when the engine has opened the sound and the level draws its face,
  not at the click (an open is a render; flying at once would land a face
  before the level shows it), from the row as it is then, steered each frame
  onto the destination (PATCH's camera fits the new patch with a tween), or
  to the menu bar's chip at a level with no place for it. A pool row's click
  also moves to PATCH; that move cross-fades, since the sound being put
  down is not the one arriving. TASTE's map and EVOLVE's ↓ patch open sounds
  without a take-up (not in this PR's brief).
- **The guide pill** shows PERFORM's five steps: its three, then *Press ⌥↑
  to zoom out to TASTE, the sound among all sounds* (ticked by arriving at
  TASTE by any move the player chose) and *Hold ⌥ to see what the model
  believes* (ticked as the view comes up), with a pinch and MODEL on a touch
  screen; the words await voice.md's approval with the first steps row. A
  player who had done the first three (and not pressed ×) sees the pill
  again for the last two, and its closing line again after them: kept, as
  the way to teach the levels to those who learned PERFORM before them, and
  said in the changelog.
- **Not built here:** the mock's arrivals that wait for the move to land
  (TASTE's pulses, LEARNING's replay start as they did, during it); a
  `?b=` stamp on `style.css` and `main.js` (there is none to bump: the
  build stamp hashes the scripts, `make -s wasm-stamp`).
- **The films:** `footage.mjs`'s `view` op clicks a stop, so a shot right
  after it now sees a 620 ms move rather than the level at rest (owed with
  the Wave 3 re-records).
- **Specs:** `shell_zoom.spec.js` is new; `shell_levels.spec.js` reads one
  section `.on` with a waiting assertion, and `goLevel` waits for the move to
  land (`landed`); `guide_pill.spec.js` and `first_run.spec.js` changed
  meaning (PERFORM's five steps, the loop's line after the fifth);
  `type_scale.spec.js` reads `--d-zoom` too (mechanical).

**PR D, as built, where it differs from §2.4 and §3:**
- **`rank` and the list's rules live in `levels.js`**, as §2.1 has it:
  `rank`, `fuzzy` (the letters' places rather than the mock's HTML, so the
  list marks them with nodes), `hitMarks` (the run `rank` counted, not the
  mock's first scattered letters) and `cmdkList` (the groups, best first
  with a query, `SOUNDS_SHOWN` 5 and 8). The mock caps every group at 20;
  here only Sounds is capped, so every command can be reached by scrolling
  or the arrows with nothing typed, by a pointer and a finger as by keys.
- **The registry** is `shell.cmd` as §2.4 has it, plus `shell.cmds(fn)` for
  commands that come and go (*Record again: ‹name›*, one per sound kept
  safe), and `label`, `hint` and `key` may be functions (a setting's *on*).
  `patch.js`, `taste.js` and `explain.js` give theirs as `cmds()`; PERFORM's
  are registered in main.js through the API `perform.js` already returns
  (`pad`, `openPalette`, `openStage`), since `perform.js` is #290's while
  this was built; `takes.js` gives the kept sounds' names (`kept`).
- **Every command is a control the app has,** run as it runs, in its own
  words (its label, its tooltip or the guide's line for its key). New words,
  drafted for voice.md and listed in the PR: the button's *Find or do
  anything*, the field's *Find a sound, a level or what to do*, the groups,
  the foot's *choose · do it · close*, *Keys and gestures*, *What does
  BRIGHT do?*, *What are the three banks?* (the brief's), *Record again:
  ‹name›* (the brief's), *Watch ‹LEVEL› in depth* (the old card's link, as a
  label), and the warm start's skip toast (*Press a key to hear it. ⌘K lists
  what you can do, with its keys.*). The mock's *Search or do anything* and
  *Search sounds and actions* are not used: voice.md's Find a sound row
  lists *search* and *Search sounds* under Not.
- **A sound runs as Enter on its bank row does,** not as a click: in your
  hands at the level you're at (a pool row's click also moves to PATCH;
  ⌘K is the keyboard's list, and a sound picked at PERFORM is played
  there). Its face slot is built `lazy` and never asks the engine for a
  face (ADR-025): a face the bank has not drawn stays an empty slot.
- **⌘K's list is a modal dialog,** so `host.blocked` holds the level keys and
  the pad keys while it is open, and it opens under no other modal (⌘K and
  `?` do nothing under the warm start, the commit pair, stage mode or a
  lesson; the ? card opened over them).
- **What ⋯ and the ? card held,** and where each went:

  | Before | After (mouse, keyboard, touch) |
  | --- | --- |
  | ⋯ › Download your taste, Open a taste file…, Download this patch, Download as a picture…, Open a patch file…, Scope & analyzer…, Re-run the three-pick warm start, Reset your taste…, Show measurements (its state), Booth mode (its state), New visitor ⇧Esc (in booth mode) | The same words as commands in ⌘K's Anywhere, a state as the hint *on*; New visitor only in booth mode, with ⇧Esc. Clicked, ↵, or tapped |
  | ⋯ › Keyboard map & gestures ?, the ? card's prose | *Keys and gestures* opens the guide's keyboard page; each action the card named is a command with its key (ADR-017: `?` away from a control opens the list) |
  | ⋯ › Watch the films ↗ | *Watch the films* ↗ |
  | The ? card's *watch ‹VIEW› in depth* | *Watch ‹LEVEL› in depth* ↗, at a level whose film is published (`data-films`), not on film or in booth mode |
  | The ? card's © line, license and source | The list's foot, right |
  | `#help-open` (?) in the menu bar | ⌘K's button, *Find or do anything ⌘K*; `?` opens the list |
  | The bank's tour `?` | Kept, and *What are the three banks?* in Anywhere |
  | The film chip | Kept, folded after `#where` (§8), and *Watch ‹LEVEL› in depth* |
  | The catalog's walkthrough `?` | Kept, and *How the catalog works* at PATCH |

  The scope's and the picture's panels hang under ⌘K's button, and their
  Esc gives the focus to it. `publish.py`'s `APP_LINKS` no longer un-hides
  `#films-link` and `#help-film`, which are gone; ⌘K reads `data-films`.
- **Not built here:** BREED TOWARD IT, which waits for the own-sound card
  (#133); `preview.html`, §4's palette capture (the PR shows the list on the
  app); the landing's and the guide's full re-capture (`capture-screens.mjs`
  now reaches the warm start through ⌘K; the run is the PR's open item if
  the browser queue did not allow it).
- **The film selectors D leaves stale,** owed with the Wave 3 re-records as
  A's to C3's are: `#ovf-btn`, `#ovf-menu`, `.ovf-item`, `#export-btn`,
  `#patch-export-btn`, `#image-btn`, `#scope-btn`, `#engineer-btn`,
  `#warm-rerun-btn` and `#help`, in `shots.json` (composing 5, playing 1,
  tour 6, view-patch 3, view-taste 6), `gen_shots.py` (composing 11,
  playing 1, tour 9, view-patch 6, view-taste 8), `playing`'s
  `gen_base.json` (1) and the storyboards (composing 6, playing 1,
  view-patch 2, view-taste 1; tour's "? opens the help card").
- **Specs:** `cmdk.spec.js` is new; `runCommand(page, label)` and
  `commandRow` join `tests/web/shell.js`. Mechanical (⋯ to `runCommand`):
  `faces`, `warm_start`, `first_run`, `failure_flows`, `taste_profile`,
  `patch_keys`, `model_view_esc`'s panels. Changed meaning: `explain`'s ?
  test (the list, not the card), `pad_keys` and `shell_levels` (⌘K's list is
  their modal), `model_view_esc` (the list, and the focus back on ⌘K's
  button), `type_scale` (⌘K's button in the bar's one row, the list's type),
  `keys_for_the_platform` (the keys the list prints), and
  `space_after_a_click` lost the file items' Enter and Space test, which
  `cmdk.spec.js` holds for ↵ and a click (Space types into the field).

## 1. Delta inventory (mock vs app)

### Header (mock `core.js` 398–423, `style.css` 81–135; app `index.html` 74–256, `style.css` 420–630)

| Element | Mock | App today | Reuse | New |
|---|---|---|---|---|
| Wordmark and lamp | AURACLE, then an amber lamp that pulses on a model update | `AURACL<b id=wm-lamp>E</b>`, the E lit by `lampOn` while a job runs | `wm-lamp` and `lampOn` (main.js) | Restyled to the mock: spaced word plus a round lamp. The lamp keeps today's meaning (lit while the model works) |
| Level name and subtitle | `.where`: "PERFORM  the sound, under your hands". The new name arrives from the direction of the move (`syncWhere` 827–842) | None: the five `.viewtab` buttons (78–84) | – | `#where`, `aria-live=polite`. Texts are the mock's `WHERE` (813). The subtitle is hidden ≤980 px |
| Held-sound chip | Face 30 px, name, ▶/■ (Space) | The name is in the keybar (`#live-label` and `#live-wait`, `index.html` ~797–801; `paintLiveLabel`, main.js 4268) and in PATCH's `#rack-play` | `#live-label` and `#live-wait` move here with their ids; the face comes from `drawVessel` and `host.faceOf`; ▶ calls `toggleAudition` (the Space path, ADR-016) | The chip markup. ▶ shows the same dotted wait ring as `#rack-play` while `playOnSettle` holds |
| TAUGHT | Cap word plus an amber mono number; the cap is hidden ≤1240 | `#taught`/`#duel-count` (97), tooltip from `renderTaught` (3374) | The ids and `renderTaught` | Restyle. The spark into TAUGHT waits for its own engine-sourced trigger and is not in this plan |
| GENERATIONS | Not shown | `#gen-count` (100) | The id | Moves into EVOLVE's head (the cap line), id kept (§6 Q7) |
| Job slot | Not shown at rest | `#job-slot` (106–110), shown only while long work runs | As is | Placed between `#where` and the chip, so the rest state matches the mock |
| Skill line | Not shown | `#skill` (111) | LEARNING already shows it (`md-skill`) | Removed from the header |
| Film chip | Not shown | `#film-chip` (91–94), `pointFilmChip` (main.js ~21800) | As is | Folded `▶ film` after `#where`. Hidden in `?film`, booth, and for unpublished films, as today (§6 Q8) |
| MODEL ⌥ | Pill with an LED. Press and hold shows the model view; a tap toggles it (`core.js` 401–408) | None. No ⌥ handling exists (main.js 5399 returns on `altKey`) | – | New in PR B (§2.5) |
| ⌘K search | "Search or do anything ⌘K"; icon only ≤1240 | `?` button (112) and the ⋯ menu (113–140) | ⋯ items become commands | New in PR D. Until then ⋯ sits in the header's rightmost slot (where the mock has its prototype-only notes icon) |
| Notes icon | "About this prototype" | – | – | **Prototype-only.** Not built. Its slot holds ⋯ until PR D, then is removed |

### Left rail, the bank (mock `core.js` 491–606, `style.css` 136–178; app `index.html` 258–297, main.js 7206–8440, `style.css` 675–1030)

| Element | Mock | App | Reuse | New |
|---|---|---|---|---|
| Tabs | POOL n / SAVED n / PRESETS n, `role=tab`, arrow keys | `.bank-filters .bf[data-f=pool\|mine\|preset]` with `.bf-n`; `selectBank` (8070) | `bankFilter`, `renderBankCounts` (7557), `selectBank` | Markup becomes `[role=tab][data-bank=pool\|saved\|presets]` in a `role=tablist`, `aria-controls=bank-list`, and `wireArrowNav` with activate |
| Head extras | None | "bank" label, `#bank-count`, `#pin-budget`, tour `?`, `#bank-note` line | `renderPinBudget` and `renderBankNote` text | The pin budget moves to the SAVED tab's title, with its count amber at cap. The note becomes each tab's title. The tour becomes a ⌘K entry (PR D) |
| Find a sound | Search field, filtering name, category and blurb | None | `bankSource` (7547) | `#bank-find`. Filters rows and presets as the source is built. A text input, so the note-key guard (main.js 5408) already holds. Esc clears it |
| Presets by category | Groups with a count | `renderPresetBank` (7977) emits `.pb-cat` | As is | Restyled to `.bank-group` plus a count |
| Row | Face 26 px, name, optional "seed"/"may go" mark, actions on hover or focus (compare, ▶, ★, save, cut), pct and liking bar only under the model view | `bankRow` (7741): face slot, origin glyph, name, NEW and the unheard dot, lineage line, utility bar, pct, ▶, five stars, save, id | Ids and classes on what survives: `.bank-item[data-id]`, `.bi-name`, `.bi-hear`, `.bi-flag`, `.bi-from`, `.bank-group.new/.replaced`, `.replaced-names` | Layout to the mock (one line, two for a child with "from X · diff"). Stars collapse to one ★ action, with 1–5 rating the cursor row as today (`rateRow`). `.bi-u` and `.bi-pct` show only under `body.model-view` |
| New, Replaced, unheard dot | As built in #94, mock 565–585 | Built | All of it | – |
| Taking a sound up | The face flies from the row into the level's `anchor()` (`A.takeUp` 157) | Click opens on the bench | `openOnBench` | PR C: `shell.takeUp(id, srcCanvas)` |

### Level rail (mock `core.js` 1063–1077, 843–873, `style.css` 360–392)

The rail is new: a vertical cross at the stage's right edge (`--rail-w: 76px`).
From top to bottom it holds "out", LEARNING, TASTE, PERFORM with EVOLVE
branching left, PATCH, then "in". It is a `nav` with `aria-label="Where you
are"`, and each stop carries `aria-current=location` when it is the current
level. Labels show on hover or focus, and a puck travels between stops. Nothing
in the app can be reused for it.

### Keys bar (mock `core.js` 632–689, `style.css` 244–262; app `index.html` 745–805)

| Mock | App | Plan |
|---|---|---|
| A 240 px side column (KEYS, `Z C4 X octave`), then the keybed C3–C6 across the full width, 78 px tall | Octave ±, panic, ⇕ tall, HOLD, UNI, ARP, SYNC, key span, arp chip and drawer, the piano (`#piano`), glide, ● REC, MIDI, `#live-label`, volume; `--keybar-h: 128px` | The side column follows the mock, reusing `#oct-down/up/label`. `buildPiano` is unchanged. `#live-label` moves to the header. The rest go into one compact cluster at the keybar's right end: VOL, MIDI, ● REC, and a **KEYS ⋯** disclosure that opens a popover with hold/uni/arp/sync/glide/tall/span/panic/arp settings, all ids kept. Each also becomes a ⌘K command in PR D (§6 Q5) |

### Each level's main area

| Level | Mock | App | Plan |
|---|---|---|---|
| PERFORM | `a-perform-doors.png`: left column has the cap (BASS · IN HAND), the name at display size with share, the blurb, and the well holding the large face with a ⇧F button. Right column has CONTROLS with Arrange and How it works, a 3 × 2 knob grid, the hood, and the pads OFFER / PEEK / TAKE / PASS | `perform.js` 320–420: head (face, title, scope), marquee (steps), deck, touch row, pads (KEEP, BACK, OFFER, TAKE, PEEK, FREEZE), offer card, XY plus hood, why | PR C. Move the existing nodes into `.pf-left` (head and well) and `.pf-right` (controls, pads, offer card, hood). The well's canvas draws the held face with `drawVessel` (glow and reflection, as stage mode does). Every `pf-*` class and `data-` stays. XY, touch, Keep, Back and Freeze go under the pads in a "More" disclosure; see §6 Q4. First steps (`pf-steps`) move to the guide corner |
| PATCH | `z-desk-patch.png`: cap, name, "4 modules · 1 modulator, in signal order", NEW PATCH, HOW TO READ THIS; a signal-flow canvas with the face at OUT; a catalogue only for a new patch | The rack workbench: toolbar rows, belief row, SVG rack, tray, spec dock, module rail on the right, teach strip | PR C frames it. The rack's subject row becomes the mock's head block (cap, title, subtitle from the rack's module count); the toolbars fold into one quiet row under it; the rack sits in a rounded well; the face is drawn at OUT (`vesselBox` beside the output jack, the same face as the header chip). The module rail stays at the well's right, inside the stage and left of the level rail. **Not** the canvas rebuild (§6 Q3) |
| EVOLVE | `z-desk-evolve.png`: a "Keep the one you'd reach for." head with pips, a small TASTE map top right, two cards with large faces, then name, category and blurb, PLAY 1, KEEP A ←, ANOTHER PAIR N, and EVOLVE POOL | `#duel-mid` and `.duel-card` (587–663): face in the header, scope canvas, mini rack, readout, play/open/pick buttons, lineage log | PR C. The card's well draws the face large in place of `#scope-a/b` (§6 Q6); `⇄ circuit` stays as a corner button; the buttons are relabelled to the mock (PLAY · 1, KEEP A · ←). Every id stays (`#choose-a` has 67 spec uses). The mini map draws TASTE's map through `taste.drawMini(canvas)` |
| TASTE | `z-desk-taste.png` | Built to the mock (`taste.js`, #101) | Restyle only. Add `anchor()` |
| LEARNING | `z-desk-model.png` | Built to the mock | Add `anchor()` (the held sound's mark on "where liking rises") |
| Stage | `a-stage.png`: wordmark and lamp top left, × top right, name and "bass · in hand" bottom left, key hints centred | `perform.js` `openStage` (~3087): `st-name`, `st-cat` "PERFORM · in hand", ticks, hint, leave | PR C. Match the wordmark and placement. `st-cat` shows the category only where the engine has one (§6, truth checks) |
| "What to try" corner | `proto-tag` bottom right | – | **Prototype-only, not built.** Its notes go into the guide's pages |
| First-visit guide | `.guide` pill bottom left: pips, one step, × (`core.js` 781–805) | PERFORM's `pf-steps` marquee (`perform.js` 3371–3422) and the bench, bank and node-bank tours | PR C. The pill becomes the one onboarding surface (ADR-009). It absorbs PERFORM's three steps and adds the mock's zoom and model-view steps; `auracle-perform-steps` is migrated |

## 2. Architecture

### 2.1 Where level routing lives

- **A new module `apps/web/shell.js`, `createShell(host)`.** It owns:
  - the level registry;
  - `show(level)`, `zoom(dir)`;
  - the header's `#where`;
  - the rail and its puck;
  - gestures;
  - the morph overlay;
  - the model view;
  - the ⌘K list.

  `main.js` imports it like `patch.js` (main.js 136) and passes a host.
- **A new pure module `apps/web/levels.js`.** It holds `LEVELS = ["learning","taste","perform","patch"]`, `ASIDE = "evolve"`, `WHERE`, `dirOf(a, b)`, `step(cur, dir)` (from EVOLVE it measures from PERFORM, as audit finding 3 requires), `railPath(a, b)` (turns the corner at PERFORM), and `rank(q, s)` with `fuzzy` for ⌘K (mock 750–757). It is unit-tested in `apps/web/tests/levels.test.mjs`, like `taste-geom`.
- **`showView` (main.js 4297–4339) becomes `levelChanged(prev, next)`.** The host callback keeps every side effect: `disarm`, `cancelPending`, `playWaitCancel`, `closeCompare`, `explain.close`, `perform.show/hide`, `refitRack`, `patchView.shown/hidden`, `positionToastLane`, `pointFilmChip`, `taste.setView`, and EVOLVE's redraw. The shell does the DOM: one section `.on`, `body[data-level]`, `#where`, `aria-current`, and the hash.
- **Rename the internal view `play` to the level `patch`.** That covers 15 sites in main.js, `#view-play` → `#view-patch`, `VIEW_FILMS` keys, `taste.setView`'s names, and `localStorage auracle-view` (read `"play"` as `"patch"` once). `footage.mjs` maps `v:"play"` to `"patch"`.
- **Start level.** It is the hash (`#perform` etc.) if valid, else `auracle-view`, else PERFORM ("at rest is PERFORM", RFC-006 §1). Today the app opens on PATCH and switches to PERFORM later (main.js 4833, 21645).
- **The keydown wiring follows the mock (1046–1050).** One capture-phase listener takes ⌥+Arrow and ⌥+Digit before any focused control. It skips text inputs (`#bank-find`, `#nb-q`, a rename, the ⌘K input), where ⌥← moves by word. The global handler (main.js 5328) stays and gets one branch: a level's `key(e)` if the shell registered one.

### 2.2 How the existing views map onto levels

| Level | Section | Registered by | `anchor()` returns |
|---|---|---|---|
| learning | `#view-learning` | `taste` (`createTaste`, main.js 19829) | The held sound's mark on the "where liking rises" map, or null if it is not on the map |
| taste | `#view-taste` | `taste` | The held sound's mark on the map (`mapPos` of `host.subjectId()`), or null if it is off the map (an offer, an unsaved edit) |
| perform | `#view-perform` | `perform` | The well's vessel box, measured from `offsetLeft/Top` and not from the transformed box (mock 776–781) |
| patch | `#view-patch` | `patchView` | The face at OUT, or null in a new patch (mock 1401) |
| evolve (beside) | `#view-evolve` | main.js (EVOLVE lives there) | Null: the face flies off to the side (mock `overlay.fly` 950–951) |

Each registration is `shell.register(level, { el, show, hide, anchor, key,
cmds })`. Modules already have host seams (`createPerform(host)`,
`createPatch(host)`, `createTaste(host)`, `createExplain(host)`,
`createAudioIn(host)`), so each module adds `anchor()` and `cmds()` to the
object it returns. `perform.show/hide` (perform.js API ~3890), `patchView.shown/hidden`
(patch.js 1095) and `taste.setView` (taste.js 1468) are the existing hooks.

### 2.3 Zoom, and what "the held sound's face carries the zoom" means in code

- **Inputs:**
  - ⌥↑/⌥↓, and ⌥← to EVOLVE (⌥→ back from it);
  - ⌥1–5, in the mock's order: perform, patch, evolve, taste, learning;
  - a rail click;
  - ⌥+wheel anywhere on `.stage`, accumulated past 70 then a 500 ms lockout (mock 1081–1087);
  - a two-finger pinch on touch (1088–1100), at ratio > 1.3 or < 0.77, with the rail leaning toward the level it would reach while pinching.

  On PATCH, ctrl+wheel and trackpad pinch over the rack keep zooming the rack camera (`zoomAt`, main.js 12400). Elsewhere they zoom levels (§6 Q9). The end of the axis nods the rail (it animates `translate`, audit finding 4).
- **The morph.** `show(next)` does the following:
  1. Read `from = levels[prev].anchor()`.
  2. Show the new section at opacity 0.
  3. Wait two frames so it lays itself out and its ResizeObserver runs (audit finding 2).
  4. Read `to = levels[next].anchor()`.
  5. Scale the old section (1 → 1.12 in, 1 → 0.86 out, ±14% sideways for EVOLVE) and fade it by 45%. Scale the new section from the opposite side and fade it in after 40%.
  6. Meanwhile draw **the held sound's face** on one fixed overlay canvas, tweening its box from `from` to `to`.

  The face is `host.faceOf(benchTree)` whitened by `host.faceStats()` (the bank's mean and spread, `faces.js` `bankStats`), drawn by `drawVessel(ctx, face, stats, {box, glow})` (`vessel.js` 57). Both ends are drawn with that same face, so the flight lands without a seam.
- **Settling.** Every move has a sequence number. `settle()` leaves exactly one section `.on` and clears all transforms (audit finding 1). A move in flight finishes before the next starts.
- **Reduced motion.** There is no morph and no puck, the swap is instant, and the name swaps without sliding. Every duration comes from `motionMs` (main.js 41), so the reduced rule zeros them.
- **ADR-012.** The flight is navigation feedback. Its one claim, "this is the sound you hold", is true only if the face is the bench's. So it is drawn only when the bench's render has a face. With no face (an edit still at the engine, or vetting refused it), the two levels cross-fade and nothing flies. The code names `faceOf`/`face_of_key` beside it.
- **Taking a sound up from the bank** (`shell.takeUp`) uses the same overlay: from the row's canvas to the current level's `anchor()`.

### 2.4 ⌘K as the one list (PR D)

- **Sources.** `shell.cmd({id, level?, label, key, icon, run, when?})` from the shell and each module's `cmds()`. Groups, as in the mock (758–776):
  - **This level:** the current level's commands.
  - **Anywhere:** the levels and their keys, Space, M save, cut, ⌥ model view, ⌘Z, `[ ]`, Z/X, and the KEYS ⋯ settings.
  - **Sounds:** pool rows, saved, and presets, each with a 24 px face. Running one does what a bank row click does (`openOnBench`, or `load_preset` with `open:true`). It shows 5 with no query and 8 with one.
- **Absorbs ⋯** (`index.html` 116–136), the hidden file inputs staying in the DOM:
  - Download your taste;
  - Open a taste file…;
  - Download this patch;
  - Download as a picture…;
  - Open a patch file…;
  - Scope & analyzer…;
  - Re-run the warm start;
  - Reset your taste…;
  - Show measurements;
  - Booth mode;
  - New visitor ⇧Esc;
  - Watch the films ↗.

  It also gains the film of this level and "What are the three banks?" (the tour).
- **Absorbs the ? card's prose.** Each action carries its key as a hint, and "Keys and gestures" links the guide's `keyboard.md`. Explain's two entries ("What does BRIGHT do?" and "Learn: what a filter does", deferred by Plan-005 task 10) land here.
- **Keys.** ⌘K or Ctrl K (with `preventDefault`, since Firefox takes Ctrl K). `?` opens the list unless explain.js claimed it over a control: explain's listener (explain.js 594) runs first and calls `preventDefault`, and main checks `defaultPrevented`. While the list is open it swallows every key; notes can't play, because the input is a text field.
- **Accessibility.** `role=dialog aria-modal`, a combobox with a listbox and `aria-activedescendant`, focus returned on close, Esc closes.

### 2.5 The model view (⌥)

- **Built as in the mock (`core.js` 716–738, 992–1014):**
  - Holding ⌥ for 220 ms shows it, and releasing hides it. Another key pressed meanwhile cancels the timer, so ⌥↑ never flashes it.
  - MODEL works the same way by press and hold, and a tap toggles it.
  - Esc and window blur end it.
  - `body.model-view` plus a tag that says *what it believes, from N picks* (or *still guessing*, from `views.styles`/`fittedFrom`).
- **What it shows, engine facts only:**
  - Bank rows: pct and liking (the ranked list's posterior); the pool sorted by liking once fitted, with the FLIP glide.
  - TASTE: halos shown even before the fit, dashed (taste.js already has the state).
  - EVOLVE: the pre-pick forecast (§6, truth checks).
  - PERFORM: each control's lean, once the engine exposes it (§6; drawn since #140).
- **Words.** Copy says "the model view", never "lens" (voice.md bans it). Identifiers are `modelView`.

### 2.6 Seams and data hooks the app itself uses

These are not test-only attributes (tests/web/AGENTS.md):
- `body[data-level]`, which CSS keys off for the level's header and keys tint;
- `.rail-stop[data-level][aria-current=location]`;
- `[role=tab][data-bank][aria-selected]`;
- `body.model-view`;
- `#where`;
- ids kept on everything moved.

## 3. Slicing into PRs

Each PR starts from main after the previous one merges, leaves the app
working, and passes `make check` and the fast browser tier.

### PR A: the frame, the header, the level rail, the keys bar

- **Scope:**
  - the grid becomes bar / bank / stage / keys (mock `style.css` 74–76);
  - the header per §1, keeping ⋯ and `?` in its rightmost slots;
  - `#live-label`/`#live-wait` move into the chip;
  - `#gen-count` moves to EVOLVE's head;
  - the tabs are removed;
  - `shell.js` and `levels.js` with the registry, `show` (instant, no morph), and the rail with click and ⌥ keys;
  - the `play`→`patch` rename;
  - start level PERFORM;
  - the keys bar's side column and compact cluster with the KEYS ⋯ popover;
  - **ADR-017** (§6 Q1).
- **Files:**
  - `apps/web/index.html` (74–140, 745–805);
  - `main.js` (`showView` 4297, tab wiring 4344–4398, the saved view 4833, reset keys 4974, `paintLiveLabel`, `VIEW_FILMS`, `pointHelpFilm`);
  - `style.css` (412–630, keybar ~2260/3824);
  - new `shell.js`, `levels.js`, `tests/levels.test.mjs`;
  - `www/video/tools/footage.mjs` (the `view` op, line 462);
  - `docs/decisions/017-the-levels-keys.md`.
- **Tests:**
  - new helper `tests/web/shell.js` (`goLevel(page, level)`: click the stop and expect `aria-current=location`);
  - mechanical migration of 108 `.viewtab[data-view=…]` lines in 41 specs plus `patch_page.js:118` (`"play"`→`"patch"`, `aria-selected`→`aria-current`);
  - `type_scale.spec.js:159` keeps `.menubar` and `--menubar-h` (56 px now; one row at 1000);
  - `film_chip.spec.js` for its new place;
  - specs that assumed PATCH at boot without clicking: grep for `#rack-` before any `goLevel`.
  - New `shell_levels.spec.js`: ⌥↑/⌥↓/⌥←/⌥1–5 and the rail move levels; `#where` names the level; ⌥↑ inside `#bank-find` does not; Space plays in every level (ADR-016); a reload restores the level; a hash link works.
- **Docs:**
  - `keyboard.md` (the tab paragraph at 53–57; ⌥ keys);
  - `glossary.md` (menu bar);
  - `first-session.md`;
  - `accessibility.md`;
  - `apps/web/AGENTS.md` table, `README.md`;
  - `docs/architecture/web-runtime.md`;
  - voice.md's row for the level rail (§6 Q2);
  - CHANGELOG.
- **Risks:**
  - The default level flips to PERFORM.
  - `Alt` alone opens the browser menu in Firefox and Edge on Windows: `preventDefault` on keydown and keyup.
  - The film shots' raw `.viewtab` selectors go stale (45 lines in `www/video/films/*/shots.json`). They are owed a re-record after the shell (Wave 3); this PR lists them and doesn't fix them.

### PR B: the bank and the model view

- **Scope:**
  - the tabs as `role=tab` with `data-bank`;
  - Find a sound;
  - grouped presets;
  - rows to the mock (§1), the stars collapsing to ★ plus 1–5;
  - pct and liking only under the model view;
  - the head extras moved to titles;
  - MODEL ⌥ and ⌥ hold (§2.5), with the bank sort and FLIP;
  - EVOLVE's pre-pick forecast under ⌥.
- **Files:**
  - `index.html` 258–297;
  - main.js 7206–8440 (`bankRow`, `renderBank`, `renderPresetBank`, `selectBank`, `renderBankNote`, the tour button), plus the header button;
  - `shell.js` (the model view);
  - `taste.js` (halos under the model view);
  - `style.css` 675–1030;
  - `footage.mjs` (the `preset` op: `.bf[data-f="preset"]`→`[data-bank=presets]`).
- **Tests:**
  - `bankTab(page, "pool"|"saved"|"presets")` replaces 43 `.bf[data-f=…]` and 2 `.bf-n` lines (`mine`→`saved`, `preset`→`presets`);
  - `.bi-id` text lookups (≈4, in `evolve_*`, `bank_lineage`) move to `data-id`;
  - `.star[data-s]` (1) moves to the 1–5 keys;
  - `faces.spec.js` (15 bank selectors; the face slot is unchanged);
  - `bank_row.spec.js`, `taste_profile.spec.js` (6).
  - New `model_view.spec.js`: hold ⌥ shows pct and liking and sorts, release restores; a tap on MODEL toggles; no "lens" in copy. Plus `bank_find.spec.js`.

  About 70 lines in about 35 specs, mostly through the helper.
- **Docs:** `bank.md` (whole page, a new figure), `glossary.md`, `teaching.md`, `accessibility.md` (Tab stops), `reading-the-model.md` (the model view), voice.md (MODEL, "Find a sound").
- **Risks:**
  - Hiding pct at rest changes what players saw before.
  - Collapsing five stars to one ★ is a density change.
  - The bank re-renders often (`renderBank` guard for a rename, 7582): Find must survive a redraw.

### PR C: the levels laid out, and the zoom

- **Scope:**
  - PERFORM well-and-panel;
  - EVOLVE cards and the mini map;
  - PATCH's frame and the face at OUT;
  - the stage-mode placement;
  - `anchor()` on all five levels;
  - the morph overlay, the rail puck, `#where`'s directional name;
  - pinch and ⌥-scroll;
  - `shell.takeUp`;
  - the guide pill absorbing `pf-steps`;
  - the duration token (§6 Q10).
- **Files:**
  - `perform.js` (layout 320–420, steps 3371–3422, `openStage` ~3087, return `anchor`);
  - `patch.js` (head, return `anchor`);
  - `taste.js` (`anchor`, `drawMini`);
  - main.js (EVOLVE 587–663 DOM, the PATCH subject row, `takeUp` from bank rows);
  - `index.html` 299–738;
  - `style.css` per level;
  - `shell.js`;
  - `www/brand/tokens.json` with `make tokens`.
- **Tests:**
  - Moving nodes keeps ids and classes, so most `.pf-*` (73/46/41/35) and `#choose-a`/`#evolve-btn` uses hold.
  - Churn is in the 6 `.pf-step` lines (to the guide pill), `.pf-xy*` (≈14, if XY moves under the disclosure), `responsive.spec.js` and `text_fits.spec.js` (PERFORM captions at 1000 and 1280 in the narrower right column), `perform_stage.spec.js`, and `faces.spec.js` (the EVOLVE well).
  - New `shell_zoom.spec.js`:
    - after a move exactly one section is `.on`, at gaps of 0, 40, 120 and 300 ms;
    - the flight's end rect equals the destination `anchor()` within 2 px;
    - no overlay under reduced motion;
    - no flight when the bench has no face;
    - ctrl+wheel over the rack zooms the camera, not the level.
- **Docs:** each `views/*.md` figure and layout paragraph it changes, plus `playing.md` and `rack.md` where the layout is described.
- **Risks:**
  - This is the largest PR. If review size demands, split it at **C1** (the layouts, the guide pill and `anchor()`, levels still switching instantly) and **C2** (the morph, puck, pinch, ⌥-scroll and token).
  - PERFORM's right column at 1000 px.
  - The two-frame wait in the morph against the rack's own resize (`refitRack`).

### PR D: ⌘K, and the guide for the levels

- **Scope:**
  - the ⌘K list (§2.4) and the header button;
  - ⋯, `#help-open`, `#help` and the overflow code removed (main.js 21704–21752, 21896–21910; `index.html` 113–140 and the help section);
  - `?` falls through to the list;
  - the KEYS ⋯ settings and every level's commands registered;
  - explain's two entries.
- **Files:** `shell.js`, `index.html`, main.js, `perform.js`, `patch.js`, `taste.js`, `explain.js` (`cmds`), `style.css` (`.palette`).
- **Tests:**
  - `#ovf-btn`/`#ovf-menu` (6), `#import-input` (2), `#image-btn`, `#engineer-btn`, `#booth-reset-btn` (2) and `.ovf-item` move to `runCommand(page, label)` in `shell.js` (≈15 lines in `booth`, `failure_flows`, `faces`, `perform_*`);
  - `?` opening help (in `first_run`, `keys_are_not_notes`).
  - New `cmdk.spec.js`:
    - ⌘K opens it, typing ranks a prefix first;
    - Enter runs, Esc returns focus;
    - a file command opens the picker;
    - no note plays while typing;
    - `?` over a knob opens explain, and elsewhere opens the list.
- **Docs (the guide's full level rewrite, ADR-004):**
  - `views/{perform,play,evolve,taste,learning}.md`, keeping the file names because `VIEW_FILMS` and the films link them;
  - a new `levels.md` ("One space": zoom, rail, the model view, ⌘K) in `SUMMARY.md`;
  - every "⋯ ›" mention: `faces.md:99`, `first-session.md:73`, `running-locally.md:76,91`, `glossary.md:32,280`, `teaching.md:85`, `rack.md:244`;
  - `keyboard.md` (⌘K, `?`);
  - `www/reference` where it names the menu (`persistence.md`, `structural.md`);
  - the landing screenshots (`capture-screens.mjs`) re-captured;
  - truth-pass skill run.
- **Risks:**
  - Removing the ? card is visible to returning players.
  - File-picker activation from a keyboard Enter: keydown is a user activation, but test it in Safari.

## 4. Acceptance

**Rules for every PR:**
- labels never move for a mark (Plan-005 task 1);
- every size, colour, space and duration from tokens (`make dev-check`);
- reduced motion makes every move instant (`type_scale.spec.js` reduced test);
- Space plays the edited sound in every level (ADR-016);
- no page errors;
- one onboarding surface per level (ADR-009);
- text budget, at most one sentence of guidance at rest (ADR-011);
- copy follows voice.md (`checkwords`).

**Widths.** Side by side with the mock at 1440 × 900. The mock has no 1280 or
1080 shots, so at those widths the mock's own media rules hold:
- ≤1240: TAUGHT's cap and ⌘K's label hide, as in `flow2-1024.png`;
- ≤980: the subtitle hides.

The app's 1000 px floor still passes (`narrow_gate.spec.js`, `text_fits` at
1000, the `type_scale` header height).

| PR | Shots to match | Must hold |
|---|---|---|
| A | The header and keys bar of `a-perform-doors.png` and `z-desk-*.png` (the level names); the rail in `v2-rail.png` | `#where` names the level; the rail's current stop is green at every level; one header row at 1000–1440 |
| B | The left rail in `a-perform-doors.png` (PRESETS, grouped) and `flow2-1024.png` (POOL); the bank under ⌥ (prototype `lin2-desk-*.png`, `b-own-*` rows) | Pct is hidden at rest; ⌥ held 220 ms shows it and releasing restores the order; the name never shifts for the unheard dot or a mark |
| C | `a-perform-doors.png`, `z-desk-patch.png` (frame only), `z-desk-evolve.png`, `z-desk-taste.png`, `z-desk-model.png`, `out-grid.png`/`in-grid.png`/`side-grid.png` (morph frames), `a-stage.png` | The flight lands on `anchor()` within 2 px; one level on after rapid moves; no flight without a face; nothing flies under reduced motion |
| D | The palette as in the prototype (no screenshot; build `preview.html` and capture it at 1440 for the PR) | ⋯ and the ? card are gone and each of their items is reachable in ⌘K; `?` over a control still asks |

## 5. Test impact

From `git grep` on origin/main `tests/web`:

| Selector | Uses | Specs | Moves in |
|---|---|---|---|
| `.viewtab[data-view=…]` | 108 | 41 | A, via `goLevel` |
| `.bf[data-f=…]`, `.bf-n` | 45 | ~30 | B, via `bankTab` |
| `.bank-item` and children (`.bi-hear`, `.bi-id`, `.bi-name`, `.bi-flag`, `.star`, `.bank-group.*`, `.replaced-*`) | ~110 | 37 | B (kept classes; ≈10 real edits) |
| `#duel-count` 16, `#live-label` 9, `#job-slot` 8, `#gen-count` 5, `#taught` 2, `#film-chip` 3 | 43 | ~15 | A (ids kept: ≈0 edits, except film chip placement) |
| `#ovf-btn`/`#ovf-menu`/`.ovf-item`/menu items | ~15 | ~8 | D, via `runCommand` |
| `.pf-*` | ~260 | ~20 | C (classes kept; ≈25 edits: steps, XY, layout specs) |
| EVOLVE ids | ~160 | ~10 | C (ids kept) |

That is roughly 300 mechanical line edits, most of them in A and B, through
three helpers in `tests/web/shell.js`: `goLevel`, `bankTab`, `runCommand`. It
also adds about 6 new specs. The hooks they use are the app's own (§2.6), so a
visual change does not break them. Off-suite, `footage.mjs` (`view`, `preset`
ops) moves with A and B; the raw selectors in films' `shots.json` are owed with
the Wave 3 re-records.

## 6. Truth checks and open questions

**Truth checks (ADR-012), each to verify in its PR:**
- **The morph's face.** It is drawn only from `faceOf` for the bench's render key. If no face exists, it cross-fades (§2.3).
- **PERFORM leans under ⌥** (mock `perform.js` 281, 330). Drawn since #140: the engine exposes each control's lean (`Engine::lean`, the worker's `perform_lean`), the posterior's slope along the control's direction at the sound in hand, through the lens that claims the sound in each draw, with its ±σ interval; it is drawn on the dial as an arc toward the end it leans to (*it leans brighter*), and as a guess (dashed, its words ending in "?") when the interval crosses zero.
- **EVOLVE's pre-pick forecast under ⌥.** The worker answers `duel_pred` (`engine.duel_pred(a, b)`, worker.js ~3075) only after the vote. Under the model view, ask for it at deal time; it is the same call on the same posterior. Verify that no refit can land between the deal and the vote and change it, and drop it if one does.
- **"BASS · IN HAND"** (the PERFORM cap, stage mode). The category exists for presets (`presetRows[].category`); a bred or edited sound has none, so the cap reads "IN HAND". Don't infer it from a seed.
- **TASTE and LEARNING anchors** exist only when the held sound is on the map. An offer or an unsaved edit isn't, so the face fades in rather than flying from a made-up spot.
- **Pinch against the rack camera** in PATCH. Proposed rule: the rack keeps ctrl-wheel and pinch, and ⌥-scroll, ⌥↑ and the rail leave (Q9).
- **The mock's PATCH** (canvas flow, estimated faces, light along cables) is already ruled by Plan-005 task 7. The face at OUT is the measured face of the bench, not an estimate.

**Open questions for the maintainer:**
1. **ADR-017, the levels' keys.** It amends ADR-009's "⌥1–4 for views":
   - ⌥↑/⌥↓ zoom, ⌥← EVOLVE and ⌥→ back, ⌥1–5;
   - hold ⌥ for the model view;
   - ⌘K the one list;
   - `?` asks over a control, else opens the list.

   The mock also binds `-` and `=` to zoom; the proposal is not to adopt them, since PATCH's ⌘−/⌘= camera keys sit beside them. Approve?
2. **The level rail's name.** voice.md uses "the rail" for the bank and "the module rail" for PATCH. Propose "the levels" in copy, with `aria-label` "Where you are", and a word-table row.
3. **PATCH: frame the rack, or rebuild it as the mock's canvas?** This plan frames it. A rebuild means deciding which of locks, layouts, minimap, tray, scope and the module rail survive.
4. **PERFORM's extra controls** (XY, touch, KEEP, BACK, FREEZE, Blend, Wander), which the mock doesn't show. Propose: Blend and Wander stay as knobs in the grid (they are controls), and XY, touch, Keep, Back and Freeze go under a "More" disclosure below the pads.
5. **The keys bar.** The mock has only KEYS and the octave. Propose the compact right cluster (VOL, MIDI, ● REC, KEYS ⋯) plus ⌘K.
6. **EVOLVE's waveform scope.** The mock draws faces. Propose: the face replaces the scope, and ⇄ circuit stays.
7. **GENERATIONS.** Propose EVOLVE's cap line, not the header.
8. **The film chip.** Not in the mock. Propose keeping it folded after `#where`, plus a ⌘K entry.
9. **Pinch and ctrl-wheel in PATCH** (the rule above).
10. **The zoom's 620 ms.** The tokens say "three durations". Propose a fourth, `d-zoom: 620ms` (0 under reduced motion), or 2 × `d-move`.
11. **The bank's width and default tab.** The mock is 272 px and opens on PRESETS; the app is 280 px (Plan-005 task 3's "a face never narrows a name") and opens on POOL. Propose 280 and POOL.

## 7. What comes after

- **A sound of your own (task 11's card).** It lands in the shell's places:
  - drop a file on PERFORM's well (C); the card opens in the well's left (mock `own.js`, `b-own-perform.png`);
  - FIND IT ON THE MAP is `shell.show("taste")`, flying the recording's face to its mark through `anchor()`;
  - the recording sits in the bank under a "yours" group (B's grouping);
  - BREED TOWARD IT is a ⌘K command as well.
- **Touch (task 8).** The shell's seams carry it:
  - the rail becomes the phone's bottom bar (`.rail` media rules, mock 398–548, audit findings 5–19);
  - the bank becomes a sheet and the keys a drawer (PR A's grid areas);
  - pinch already drives `zoom`;
  - MODEL's press and hold is the touch model view;
  - `body.touch` hides `kbd`;
  - the narrow and handheld gates retire there, not here.

### Critical files for implementation
- `apps/web/main.js` (showView 4297–4398, keydown 5328–5480, bank 7206–8440, overflow and help 21704–21910)
- `apps/web/index.html` (header 74–256, bank 258–297, views 299–738, keybar 745–805)
- `apps/web/style.css` (frame 412–630, bank 675–1030, keybar)
- `apps/web/perform.js` (layout 320–420, steps 3371–3422, stage ~3087, API 3794+), `apps/web/taste.js` (setView 1468)
- `docs/notes/vision-2026-09/prototype/core.js` (header 398, bank 491, keys 632, lens 716, palette 742, guide 781, levels and morph 812–968, keys 980–1060, rail 1063, gestures 1079) and `style.css` (74–76, 360–392)

## 8. Maintainer decisions (2026-10-02)

- **PATCH: rebuild to the mock's canvas signal flow.** Drop no functionality: anything the mock lacks must still be represented in the new design. Backend concepts that could be lifted into the UI, following the design, are proposed to the maintainer as questions before building.
- **PERFORM extras:** integrate XY and touch into the mock's design. Keep, Back and Freeze keep their functions but need not keep their buttons (e.g. freeze by press-and-hold on WANDER).
- **Keys bar:** the mock's side column, plus a compact cluster (VOL, MIDI, ● REC, KEYS ⋯ with the rest), all also in ⌘K.
- **ADR-017 approved** as proposed: ⌥↑/⌥↓, ⌥←/⌥→, ⌥1–5, hold ⌥ for the model view, ⌘K, `?` over a control else the list. No `-`/`=`.
- Defaults taken for the rest: "the levels" in copy; face replaces EVOLVE's scope, ⇄ circuit kept; GENERATIONS in EVOLVE's cap; film chip folded after the level name plus ⌘K; PATCH rack keeps ctrl-wheel/pinch; a `d-zoom` token; bank 280 px.
- **Overall rule (maintainer):** drop no functionality anywhere in the shell. Stay as close to the mock as possible, and integrate every capability it lacks.

## 9. Maintainer decisions, round 2 (2026-10-02), from the design inventory

- **PATCH camera:** quiet corner controls in the well's bottom-left (fit · − · + · map · layout ▾ chain/compact/by hand + snap + reset; bookmarks with the map). Signal-order flow by default.
- **PATCH keys:** the mock's (←/→ signal order, ↑/↓ into modulators, Enter into knobs, Esc out, Home/End first/OUT; structure menu on F2/right-click; fit-all ⇧Home).
- **Catalog:** on demand in the well (ADD MODULE always in the head, and /); everything from today's rail kept; θ bars under ⌥; price and ▶ preview on the well's top line.
- **Locks and ⚡:** "⚡ EVOLVE FROM THIS ▾" in the head (▾: lock knobs / wiring / clear); selected module shows its lock; lock dots on knobs on hover/focus; L locks; solid edge when locked.
- **⌥ in PATCH:** all of it (family lean edges, worth per kind, belief line in the subtitle, the guess's runners-up as fainter plates).
- **Engine facts, all four:** measured "without this module" outline at OUT (face_of_tree on the bypassed patch); "What goes here?" on any socket (guess `at`); what a generation changed (lineage ticks + seed values as pale pointers, while unedited); which PERFORM controls turn the selected knob.
- **Pad keys (ADR-018):** N Offer/Next, hold B Peek, ⇧↵ Take; a "moved · KEEP · BACK" bar when the sound has left home, ↵ Keep (no control focused), ⇧⌫ Back; Freeze = tap Wander (no key), state on Wander; "Next" stays.
- **PERFORM layout:** XY a mode of the well (button beside ⇧F); Blend a slider under the two faces while an offer is held; Wander an amber knob at the start of the pad row (WANDER · OFFER · PEEK · TAKE · PASS); touch a row in Arrange + "vel" tick. PASS (without growing another) is new if no path does it.
- Words: keep "PICK A ←" / "Pick the one you'd reach for." (voice.md); "keep as new" in PATCH's edit bar; GUESS not SUGGESTED.
