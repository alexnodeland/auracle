---
title: "The sound at the centre: one space, shown as it works"
number: 6
status: accepted
author: Claude Code
created: 2026-09-30
updated: 2026-10-01
supersedes: null
superseded_by: null
---

# RFC-006: The sound at the centre

## Audience

- **The maintainer**, who decided most of this in eight rounds on 2026-09-30
  and approved the prototype's visuals.
- **Anyone building the views** under [Plan-004](../plans/004-one-design-system.md),
  the engine work this needs, or the plugin.

[RFC-004](004-design-direction.md) set the design system: one source for words,
marks, picture, interaction, sound and explanation. This proposal sets what the
views built from that system become.

## Context

Plan-004 rebuilds each view to a specimen the maintainer approves. The first
specimen pass was prototype v1, four tabs restyled. Its verdict was "a good
start… be more expressive and bold… a world class UI with impeccable semantics,
clear navigation, nuanced interactions, great visual hierarchy, great component
linking, absolutely stunningly beautiful visuals."

Seven rounds of questions followed. Prototype v2 was built from the answers and
reviewed before the maintainer saw it: six areas, on a desktop, a phone and a
small phone, with real input. It was then corrected against the engine, after
the maintainer asked that it "maps well to the actual evolution underneath.
Don't have animations or interactions just for the sake of it." On 2026-09-30
the maintainer approved its visuals.

The evidence is in [`docs/notes/vision-2026-09/`](../notes/vision-2026-09/):
- the decisions, round by round;
- the prototype's source (`python3 build.py`, then open `preview.html`);
- the review.

The prototype plays the presets' recorded phrases and does not run the engine.
Its notes list every stand-in.

## Proposal

### 1. One space, with the sound in hand at its centre

The four pages become one space. The sound you are holding stays in the
middle, and depth is literal.

- **At rest is PERFORM:** play it.
- **Zoom out to TASTE:** the sound among every sound, on the map.
- **Zoom out again to LEARNING:** the model room.
- **Zoom in to PATCH:** what it is made of.
- **EVOLVE sits beside them:** what it could become.

You move by zooming: pinch, ⌥-scroll, ⌥↑ and ⌥↓, or the rail on the right,
which always shows where you are. The header names the level. The held sound's
own face carries you between levels, so you can see what the zoom is on.

Two things are kept from v1. ⌘K is the one list of everything you can do,
replacing ⋯ and the ? prose. Holding ⌥ shows the model's view (the lens).

Everyone gets the musician's experience first. Each kind of player then goes
deeper in their own direction:
- a sound designer into PATCH;
- a newcomer into the lessons;
- a curious reader into LEARNING.

The way in is the same for everyone and always starts at the top. Approaching
a control gives a hint; asking (? on a desktop, a long press on a phone) gives
a figure; going in gives the full detail. Nothing remembers how deep you went,
and nobody picks a profile.

### 2. The face everywhere

Every sound has a face, the vessel:
- it is the sound's spectrum, whitened against the bank, so it shows how this
  sound differs from the rest;
- it is mirrored, with the low frequencies at the base;
- it has twelve layers, one per slice of time.

It is the sound's identity on every row, chip and card. It is a card you can
share. It is also a live instrument: in stage mode (⇧F) the vessel is a
keyboard on its side, and a note lights its own pitch.

### 3. Show the mechanism, and only the mechanism

What happens under the hood is shown as faces moving, not as sentences. The
rule is [round 7](../notes/vision-2026-09/decisions.md)'s: **an animation shows
only a fact the engine produces.** If the engine doesn't record something, it
isn't drawn; if it must appear, it is marked as a guess in dashed amber, the
convention for a guess. This is an engineering rule contributors must keep, so
it is proposed as ADR-012, alongside ADR-004's rule for words.

Each animation the prototype builds, and the engine fact it shows:

| Shown | The engine fact |
| --- | --- |
| An offer grows out of the sound in hand, carrying that sound's outline | An offer is a short Metropolis walk from the patch on the bench (`Engine::offer` → `refine_walk` → `walk_on`), 20 steps. It is never drawn from the bank. |
| Taking an offer fills it with green; passing folds it back | A take or pass counts as a pick only after the offer was heard for a second (`perform.js`). Neither puts anything into the pool. |
| A pick is an arrow from the sound passed to the sound kept, and every glow on the map moves at once | The taste model is Bradley–Terry on `θ·φ` (`auracle-taste`). A pick reweights the posterior along φ(kept) − φ(passed), so every rating moves. It is not a local effect. |
| A refit settles every glow together, and the map turns rather than mirrors | Every sixth pick refits the whole posterior and the standardizer. The map's PCA axes are pinned to the last map (`map.rs`). |
| Pointing at EVOLVE POOL marks the seeds and the sounds that may be replaced | The seeds are the pool's best-rated quarter, by posterior mean (`refine_jobs`, `ranked()`). The marked candidates for replacement are the lowest-rated unsaved sounds. |
| Each child buds from its seed and flies into the bank's New group | Each seed walks 40 steps to one child, a new patch, and leaves the seed unchanged. The engine records the child's seed and the tree diff (`LineageEvent`). There is no crossover. |
| A child the pool won't take fades beside its seed | A child is admitted only if it beats the weakest sound it would displace (admission in `engine.rs`). |
| At the end, the lowest-rated sounds fade from the bank; a saved one never does | `refine_finish` trims the pool back to size, lowest first, and pins are exempt. A child can be trimmed too. The trimmed trees are dropped. |
| A child rated below its seed is marked "exploring" | A walk can step downhill. The lineage event carries both ratings. |

Proposed next, each a real fact or waiting on one:
- **A face develops as it renders,** slice by slice, if the render reports its
  progress in time.
- **The warm start draws its eighteen answers** as threads.
- **Save and cut.** Save drops the face onto the Saved shelf. Cut sinks it out
  of the bank as evidence against it: the engine keeps a cut as a pick.
- **Wander leaves a trail** across the map. Drift is a knob-only walk
  (`perform_drift`).
- **A named control turns its knobs in a patch inset,** in step. Its wiring is
  measured.
- **A guess is blurred by how unsure it is.** The map already has
  `utility_std`.
- **Faces below the sonic floor are drawn hollow,** once RFC-005 exists.

### 4. PERFORM: a pedal over the circuit

PERFORM's named controls are higher-order than a patch's knobs, and players
think in different higher-order terms. So the controls become **a palette**:
- 18 controls in six families: tone, weight, dynamics, space, movement and
  character;
- the player places, hides and orders up to eight of them, building a pedal
  over the modular circuit;
- each palette entry previews what it would do to this sound.

**How it works** explains whichever control you last touched, with every
control a tap away.

The mechanism is today's. Each control is a direction in the standardized
features (Bright raises centroid and rolloff). On each patch it is wired onto at
most four knobs by a measured Jacobian. A control the patch cannot reach becomes
a search control, which aims offers along that direction instead of faking it
(`perform.rs`).

A palette of 18 needs twelve more directions defined in the engine. Each is
measured per patch like the six. Some will be search controls on many patches,
and the palette says which. Making your own control, by bundling knobs with
directions, comes later.

### 5. PATCH: everything editable, modulation you can see, start from nothing

- **Everything is editable.** On a phone, a tapped module opens a sheet with
  every setting as a wide slider with steps; it closes by swipe, ×, or a tap
  outside.
- **Edits are heard.** A change is heard live and on replay. This was measured
  in the app on 2026-09-30, and a ▶ pressed during an edit now waits for it
  (`claude/patch-edits-audible`).
- **Modulation you can see:** live cables, moving knobs and measured levels.
- **Start from nothing.** An empty patch, and the model suggests the next
  module. A suggestion can be skipped, a module removed (with undo), and the
  patch cleared.

How the model suggests a module is not designed yet (Open question 2). The
structural part of φ can rate a candidate addition without a render, but the
audio part needs one.

### 6. EVOLVE and the bank: lineage you can read

- **Before a generation:** pointing at EVOLVE POOL marks the seeds and the
  sounds that may be replaced. The app already marks the second.
- **During a generation:** each child grows from its seed. The pool's New group
  forms as they land, and the button narrates each walk ("Walk 3 of 10 ·
  kept", "rated below the pool").
- **After a generation:** the bank says what happened.
  - **New · generation N** lists each child with its seed's face, "from
    *seed* · what changed", and a dot until you have heard it. The dot sits
    left of the name, in space the row already has, and the name never moves.
    New clears when the next generation's first child lands, as now.
  - **Compare** shows the child's face walking out of its seed's outline, the
    diff, what the model rated each when it bred them, and plays both while
    both exist.
  - **Replaced · generation N** lists names only, because the engine keeps
    nothing else.

Hearing or restoring a replaced sound would need the engine to keep its tree
until the next generation: Open question 1.

### 7. TASTE and LEARNING

- **TASTE** is the map of every sound (PCA positions; glow is the posterior
  mean; size is the uncertainty), how taste moved over time with a replay, and
  the lens.
  - **Per-pick redraw.** Picks draw as arrows and the glows move with each
    pick. The engine reweights on every pick, but today the app redraws only on
    a refit. Showing it per pick means posting the belief after each pick
    (Open question 3).
- **LEARNING** is the model room:
  - the weights, and the evidence of each pick flowing into them;
  - the direction liking rises on the map;
  - the forecasts, scored as each pick is made;
  - the data, exportable as JSON;
  - the maths. φ is 18 audio and 26 structural features. The posterior is 500
    draws. It grows a lens for every 20 picks, up to five.

### 8. A sound of your own, and audio in

- **Bring your own sound:**
  - drop a sound file on the well, and its face appears;
  - it takes its place on the map, and the presets nearest it lean in;
  - the model can breed toward it.

  This needs features from a decoded file (`auracle-features`), a binding, and
  walks tilted toward its φ, as aimed offers are today. Dropping a file today
  loads a patch file.
- **Audio in:**
  - an AUDIO IN node can be processed (Auracle as an effect), drive
    modulation, play the patch (pitch and dynamics tracking), or be resampled
    as a new source the model can breed;
  - there can be several inputs: a node lists the input devices it detects,
    and the same input can feed several nodes.

  The layering is decided:
  - the DSP in quiver;
  - the node kinds in `auracle-grammar`;
  - φ in `auracle-features`;
  - the bindings in `auracle-wasm`;
  - capture in `apps/web`;
  - the host input in the plugin.

  The engineering is its own proposal.

### 9. Explain anything, then lessons

Asking about anything (? on a desktop, a long press on a phone) gets an animated
figure, not a paragraph. From a figure, a short lesson uses the sound in hand
("what a filter does", one minute). Explanation lives in figures and the guide,
as RFC-004 part 8 set.

### 10. Touch, stage and beyond the browser

- **A phone gets its own layout,** designed for touch, not squeezed:
  - a bottom bar;
  - the bank as a sheet;
  - the keys as a drawer;
  - swipe up to keep;
  - sheets for modules and the palette.
- **Stage mode (⇧F):** play, and each note lights its pitch on the vessel.
- **A DAW plugin (AU/VST3)** is the platform beyond the browser. It is its own
  proposal.

## Where each part lands

| Part | In the app today | Lands in |
| --- | --- | --- |
| One space, zoom, the rail, ⌘K | Four views and a menu bar | web |
| Faces everywhere, share cards | An image export | web, computed from each render |
| Offers growing from the sound in hand | Offers and the heard rule exist | web |
| Picks as arrows, glows per pick | Redraws on a refit only | web, plus a belief posted per pick (wasm) |
| Seeds and may-be-replaced marks | May-be-replaced exists | web, plus the seed count exposed |
| Children from seeds, New, Replaced, Compare | New group, a 3-line lineage strip | web, from `lineage()` |
| Hearing or restoring a replaced sound | Impossible: trees dropped | engine (Open question 1) |
| The palette of controls | Six controls | engine (twelve directions) and web |
| PATCH's module sheet on touch | Knobs on the rack | web |
| Start from nothing, a suggested module | "Add a module at the output" | engine (Open question 2) and web |
| Modulation levels on cables | Not measured | engine probe and web |
| LEARNING | TASTE's tabs | web, from the posterior |
| Explain anything, lessons | Tooltips, the guide | web and guide |
| Stage mode | Booth mode (a kiosk) | web |
| Your own sound | Drop loads a patch file | features, wasm, web |
| Audio in | None | quiver, grammar, features, wasm, web, plugin (own RFC) |
| DAW plugin | None | own RFC |

## Found along the way

Tracing the engine turned up descriptions that aren't true (ADR-004) and three
gaps. None of these is fixed here; each is a small follow-up.

- **Descriptions that aren't true:**
  - The guide's introduction (`www/docs/src/introduction.md`) says "every
    crossover". There is no crossover.
  - A refused child's message says it had to "beat its parent". The bar is the
    weakest sound in the pool (`apps/web/main.js`, the `not_admitted` text).
  - "No move was accepted" also shows when children were bred but refused, or
    were duplicates.
- **Gaps:**
  - A ⚡ child never gets the New tag.
  - Bank rows don't show a child's seed or what changed, though the engine
    records both.
  - The per-child reason the worker posts is never shown.
- **Found by the PATCH check:**
  - Space in PERFORM and EVOLVE plays the preset's saved recording, not the
    edited patch on the bench.
  - Space after a click on a wave chip changes the wave again.
  - A selector change (wave, filter kind) reaches held notes only after the
    re-render.

## Sequencing

1. **On acceptance** (done):
   - ADR-012 records the rule in part 3, with a line in `apps/web/AGENTS.md`
     and `www/AGENTS.md` pointing to it.
   - Plan-005 breaks this proposal down alongside Plan-004:
     - the prototype stands as the approved specimen for the views' layout
       and disclosure (Plan-004 task 4);
     - Draft 1's five choices are approved as the prototype sets them;
     - its type, spacing and motion values go into `tokens.json`;
     - Plan-004 task 7's explanation figure is the lineage Compare.
2. **Web parts that are true today:**
   - the shell, faces, PERFORM over today's six controls, and EVOLVE's lineage
     display;
   - TASTE and LEARNING from today's data;
   - the touch layouts;
   - the found-along-the-way fixes.
3. **Engine parts:**
   - the belief per pick and the seed count;
   - the palette's directions;
   - the module suggestion;
   - cable levels;
   - Open question 1, if decided.
4. **A sound of your own.**
5. **Audio in**, by its own proposal, quiver first.
6. **The plugin**, by its own proposal.

The films come after the view rebuild, cast from above the sonic floor
(RFC-005), with the sound the audio proposal (RFC-007) sets.

## Alternatives considered

- **Keep four pages, restyled** (v1). Rejected in round 1 for the sound at the
  centre: the pages split one object into four places.
- **Chosen profiles or remembered depth.** Rejected in round 2. Everyone gets
  the same gestures, from the top.
- **The patch as text, and draw-to-search.** Not chosen (rounds 4 and 1).
- **Motion as decoration.** Rejected in round 7. Every animation has to say
  something true.

## Consequences

- **The rebuild targets a new structure:** more work than restyling, and the
  films wait for it.
- **The web app reads more of the engine:** lineage, the belief per pick and
  the seed count. Each is small and already computed.
- **Every animation becomes a claim:** when the engine changes, its animations
  are checked like its words (ADR-012 beside ADR-004).
- **The guide changes with the structure:** each view's pages are rewritten as
  it lands.

## Decided (maintainer, 2026-09-30)

Round by round in [`decisions.md`](../notes/vision-2026-09/decisions.md). In
short:

1. **Audience:** the musician's experience for everyone, with deeper dives per
   profile. **Feel:** a precision instrument. **Structure:** the sound at the
   centre. **The face:** identity everywhere, shareable cards, a live
   instrument.
2. **Moving is zoom.** The same gestures for everyone, always from the top.
   Keep from v1: ⌥ for the model, ⌘K as the one list, dashed amber for a
   guess, controls naming their modules.
3. **New capabilities, all:**
   - bring your own sound;
   - taste over time;
   - explain anything;
   - stage mode;
   - audio into the graph;
   - comprehensive mobile.

   **Beyond the browser:** a DAW plugin. **Learning:** figures, then lessons.
   **The model:** the lens and the map, a model room, export, watching it
   think.
4. **Audio in, all four uses.** Multiple inputs, device selection, one input to
   several nodes. Each piece in the right crate, and quiver updated as needed.
   **Mobile:** everything, designed for touch. **PATCH:** everything editable,
   modulation you can see, start from nothing.
5. **Show the mechanism:** faces moving, not words.
6. **The palette of controls:** a pedal over the circuit. Also from round 6:
   the module sheet on touch, How it works for every control, and a new patch
   that can be cleared and edited.
7. **True to the engine:** no animation for its own sake. The audio branding
   is held to the same standard, in its own proposal.
8. **The prototype's visuals are approved,** including Draft 1's five choices
   as the prototype sets them:
   - a type ratio of 1.2;
   - 11 px labels;
   - a filled primary action;
   - raised depth for pads and the primary only;
   - hints in place.
9. **Accepted** (2026-09-30), with ADR-012 and Plan-005.

Accepted as [ADR-012](../decisions/012-motion-shows-what-the-engine-does.md).
Built as [Plan-005](../plans/005-the-sound-at-the-centre.md), within Plan-004's
design system. RFC-005 takes the sonic floor, and RFC-007 the films' sound.

## Open

Each is decided as its task in Plan-005 comes up.

1. **Keep a generation's replaced trees until the next one,** so they can be
   heard and brought back. The cost is up to ten trees in memory and in the
   session save.
2. **How the model suggests the next module** in an empty or growing patch.
   *Design note (2026-10-01):* four designs measured on the engine, with a
   recommendation (render the modules the output can take on the farm, and
   rank them by a lower bound on the gain) and what is left to decide
   ([`docs/notes/suggest-2026-10/`](../notes/suggest-2026-10/README.md)).
   *Decided (2026-10-01):* the recommendation. The modules the output can
   take are rendered on the farm and ranked by the lower bound, eight in the
   structural order when there is no farm, and nothing before the warm start.
   The app calls it the model's guess (GUESS · FILTER, with its reason in the
   model's italic). A skip keeps that family away from that socket for the
   patch, and undoing a taken guess counts as a skip.
3. **The cost of posting the belief after every pick,** so TASTE and the
   bank's ratings move per pick.
   *Answered (2026-10-01):* under 2 ms per pick in wasm at five lenses
   (under 1 ms at 30 picks), about 4 ms while a generation is open, so it is
   posted with every pick; the whole map is not
   ([Plan-005, Measured (task 9a)](../plans/005-the-sound-at-the-centre.md#measured-task-9a)).
4. **The palette's twelve new directions:** how each is defined in φ, and how
   often each is reachable.
