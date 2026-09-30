---
title: "Design direction: one system for words, marks, picture, interaction, sound and explanation"
number: 4
status: accepted
author: Claude Code
created: 2026-09-29
updated: 2026-09-30
supersedes: null
superseded_by: null
---

# RFC-004: Design direction

## Audience

The maintainer, who decided the questions at the end, and anyone who
writes copy, draws UI, makes a film or chooses the first sounds a player
hears. [RFC-003](003-one-instrument-contracts.md) (Wave 2) fixes the shared
words, colours, undo, messages and keys across the views; this proposal sets
the direction those contracts serve, and covers what they leave out.

## Context

Watching the first round of view films (recorded 2026-09-29, held rather than
published; see [the film runbook](../runbooks/finish-the-view-films.md)) made
four gaps plain, and measuring the app's text made a fifth:

- **Too fast.** The narration measured 195–203 words a minute in all six
  films. The pipeline's own target is 160 (`TARGET_WPM` in
  `www/video/voice/asr_check.py`) and `www/video/films/VIEWS.md` asks for
  150–170. The voice runs at speed 0.9.
- **Bad sounds on camera.** A walkthrough plays whatever its seeded session
  deals, and much of that is blaring, noisy or harsh. The level work shipped
  earlier (one loudness for every patch, no true peak over 0 dBTP) fixed
  level, not timbre. Nothing measures harshness, roughness or fatigue: the
  vet catches pathology only, on purpose (`crates/auracle-features/src/vet.rs`),
  and 16% of a fresh pool puts less than a fifth of its energy where a laptop
  speaker plays (#62).
- **Walkthroughs only.** The view films show the app and say what it does;
  they rarely show why. The illustrated films (math, dsp, engine) explain with
  computed figures, but the two kinds never meet. The app has the same gap:
  "the app explains *state* superbly and *causation* not at all"
  ([`musical-instrument-review.md`](../notes/musical-instrument-review.md)).
- **UI quality and interaction.** The interaction review's quality findings
  (layout, density, legibility, motion) are still open: B's controls spread
  over three rows (PF-08), scopes take most of EVOLVE while its teaching
  surface is 10 px (EV-19), knob names vanish at 1280 px (PA-15), five ambers
  that cannot be told apart (TA6), 10 px canvas labels (TA20), ▶ in seven
  forms (CO4), button families that follow no rule (CO8)
  ([`findings.json`](../notes/interaction-2026-09/findings.json)). The
  components each view is built from are styled view by view, and the views
  explain themselves in sentences.
- **Too many words at once** ([measured](../notes/text-2026-09/README.md)).
  Every view shows five or six sentences of guidance at rest, each from a
  different surface, and 800–1,700 more words in tooltips. How to play the
  first note is said three ways. The **?** card is 799 words, six of its
  paragraphs 59–80 words each; the lineage log reports a generation as
  sentences of numbers.

Most of a direction already exists. It is spread out, and it has drifted:

- **A brand spec** ([`www/brand/index.html`](../../www/brand/index.html), "the
  specification … also the specimen"): the mark (an aura outward, a posterior
  inward), the logotype (Jost caps on a tracking ramp), four lockups, the lamp
  rule and a five-icon set.
- **A colour law and a type law**, stated at the top of five stylesheets:
  two phosphors (green is sound, amber is the model's mind), silk ink, no
  third colour; Jost for the panel's silkscreen, IBM Plex Mono for values,
  Newsreader italic for the model speaking.
- **A layout spec**, [`ui-hierarchy.md`](../notes/ui-hierarchy.md): three
  levels (the sound; what you do to it; why, and how it works), nothing at
  level 3 taking space at rest, one teaching surface per view, no placeholder
  rows, toolbars grouped by concern.
- **A film spec**: `VIEWS.md` and `SCRIPTS.md` (speak to *you*; show, then
  say; one idea a sentence), a music spec (the *study* bed, played by
  Auracle's own presets) and a mix standard (−16 LUFS, −1 dBTP).
- **Copy rules in six places**: ADR-004, the `AGENTS.md` files, the
  docs-writer agent, the changelog skill, `VIEWS.md` and code comments.
- **Wave 2's accepted contract** (ADR-009): the word table, the colour roles,
  one undo, six channels, the keys.

Where it has drifted:

- The palette is copied by hand into six places (app, landing, docs theme,
  brand page, film stage, film kit) and already disagrees: the kit's deep
  amber is `#6e4d22` against `#7a5526` everywhere else, and the stage has no
  deep amber at all. There are four type scales and three spacing scales for
  one set of faces.
- The brand page draws the live lamp green; the app lights it amber. Amber is
  right (the lamp means the model is working), so the page is wrong.
- The docs header's lockup is off the spec's tracking and proportions, and the
  social card uses the horizontal lockup where the spec assigns the stacked
  one.
- Four taglines are live: "searches for your sound", "learns what you like",
  "learns your taste", and "Pick the sound you like better".
- The brand spec forbids a light palette; the docs ship one ("Paper").
- The icon set is not used in the app, which draws its icons with Unicode
  glyphs instead (⚡, ▶, ★, ⋯ and a dozen more), none with a
  text-presentation selector, so ⚡ can render as a colour emoji.
- The app has 23 keyframe animations and no motion tokens, and several pulse
  without meaning, against the brand's own rule that "a light that pulses
  without meaning is worse than no light".
- `ui-hierarchy.md`'s rules have come undone. PATCH shows six sentences of
  guidance at rest, from six surfaces, where the rule set one teaching surface
  (it had four when the rule was written); its spec strip is a placeholder row
  again (PA-17); and its toolbar is nine equal-weight buttons. Nothing checks the rules, so each new feature brought
  its own sentence.

## Proposal

One design system, written down once, generated into every surface, built
into shared components, and checked. Eight parts.

### 1. One source

`www/brand/` becomes the single source for everything visual and verbal: the
marks (as now), the tokens, the voice guide, and the sound and film direction.
The tokens (colour, type scale, spacing, radii, motion durations and easings)
live in one file, `www/brand/tokens.json`, and a build step writes the CSS each
surface imports: app, landing, docs theme, film stage and film kit. The docs'
light theme is defined there too, as a second palette for the docs only
(decision 2). A check in `make dev-check` fails on a colour, size or duration
defined anywhere else, and on a raw hex in a rule (well over a hundred in
`apps/web/style.css` today, outside its tokens). The drift above then cannot
recur.

### 2. Voice and tone

One guide, `www/brand/voice.md`, replaces the six scattered sets of rules,
which then point to it. It states:

- **Who each surface speaks to**: the player in the app and the guide, the
  curious in the reference, someone deciding on the landing page, the viewer
  of a film.
- **Four registers.** *Silk*: panel labels and the things you press, a noun
  or a verb, never a sentence. *Plain*: toasts, status lines and the guide;
  sentence case, present tense, second person, one idea a sentence, no
  marketing adjectives; in the app, held to part 5's text budget. *The
  model's voice*: Newsreader italic, lowercase and declarative, naming its
  limits as facts, reserved for what the model believes and why.
  *Narration*: speak to *you*, show then say, at part 7's pace.
- **Words**: RFC-003's word table, and the banned-words check it calls for,
  built at last (`www/checknames.py` checks only code names today).
- **Claims**: ADR-004 as it stands; no number a seed can move.
- **The tagline**: "A synthesizer that searches for your sound" (decision 1),
  everywhere the other three appear. The descriptor under it is drafted in the
  guide for approval.
- **Spelling**: British (colour, centre), which the site already mostly uses.

### 3. Marks

Keep the mark, the logotype and the four lockups: they are coherent and fully
specified. Fix the surfaces that disagree with the spec: the lamp is amber on
the brand page too; the docs header follows the tracking ramp; the social card
uses the stacked lockup with the descriptor. Amend the spec to allow the docs'
light theme. Wire the icon set into the app and extend it to every action the
app now shows as a glyph (▶ in one form, ⚡, save, cut, star, undo), on the
set's 24 px grid, 2 px stroke and `currentColor`. No emoji-presentation glyph
remains in the UI.

### 4. Picture: type, grid and motion

- **One type scale**, one ratio, shared by the app, the landing page, the docs
  and the films (the films use it at 1080p multiples), with a floor for canvas
  labels (proposed 12 px; TA20 found 10 px too small).
- **A layout grid and a density rule** for the views, framed by
  `ui-hierarchy.md`'s three levels: the sound largest, one primary action per
  view, nothing at level 3 taking space at rest.
- **Motion**: tokens (three durations, two easings) and one rule: nothing
  moves without meaning. Every animation says that something changed, is
  happening, or needs you. The idle pulses go.
- **Light mode**: the docs only (decision 2). The app, the landing page and
  the films stay dark.

### 5. Components, interaction and disclosure

The app's components and the way each view reveals itself are redesigned,
not patched. The rules in `ui-hierarchy.md` were right and did not hold,
because each view styled its own controls and explained itself in its own
sentences. Here the components carry the rules, and a check measures them.

- **A component set.** One look and one behaviour per kind: primary,
  secondary, toggle, destructive and disclosure controls (closing CO8), ▶ in
  one form (CO4), and one each for the surfaces every view repeats: the knob,
  the pad, the bank row, the card, the toast, the status line, the empty
  state. Each is built once in `apps/web` from the tokens, and the views
  compose them rather than styling their own.
- **Three levels of disclosure**, as `ui-hierarchy.md` defines them. At rest:
  the sound and the view's verbs. On approach (hover, focus, or the first time
  a control matters): a label or a one-line hint on the thing itself. On
  request: the explanation, as a figure first (part 8) and a sentence second.
- **A text budget, checked.** At rest a view shows at most one sentence of
  guidance, from one surface. No instruction appears on two surfaces. No
  placeholder rows: a surface with nothing to show is not drawn. Outside the
  guide, no block runs past 25 words. A tooltip holds a name and a key, at most
  eight words, and nothing a player needs is only in a tooltip, since touch
  and keyboard cannot reach one. [`measure.js`](../notes/text-2026-09/measure.js)
  becomes a browser spec that fails on a breach.
- **Learn by doing.** A first visit teaches one act at a time (play a note,
  pick, turn a control, breed), each shown when the one before is done and
  gone once it is. The **?** card becomes a map of keys and gestures, drawn,
  with a link to the guide for the prose.
- **Each view's experience, drafted before it is built.** For each view, a
  disclosure map (what shows at rest, on approach, on request) and a specimen
  of its layout, made as a visual page and approved by the maintainer before
  the view is rebuilt (decision 5). The quality findings are closed against
  them: PF-08, EV-19, EV-04, EV-15, PA-15, PA-16, PA-17, PA-22, TA15, TA20.

### 6. Sound

Two kinds: the app's patches, and the films' sound.

- **The first sounds a player hears are good.** Today the boot fill, the
  warm start and the first duels deal whatever the prior draws. The direction
  is a *sonic floor* measured by the engine: harshness (for example sensory
  roughness and the share of energy far above the laptop band), noise
  dominance, and register. It governs two things: a session's first deals
  come from above it, and the films cast from above it (decision 6). After
  that the model follows the player's picks, below the floor as well: harsh
  can be someone's taste. The prior is not reweighted by the floor; #62's
  octave reweighting stands or falls on its own measurements. The vet stays a
  pathology gate. The engineering is its own proposal (RFC-005): where the
  measurement lives, what it costs, and whether filtered first deals move the
  search's measured numbers (`make revalidate`).
- **No UI sounds** (decision 3). The instrument's only sounds are its
  patches, so nothing plays over the two sounds a player is comparing.
- **Films cast their sounds rather than dealing them.** A walkthrough plays
  presets, or patches chosen from above the floor, not whatever the seed
  deals. The app's audio sits a set amount under the narration, and the bed
  follows `VIEWS.md` (out under a demo). A film's sounds are listened to and
  approved before recording.

### 7. Films

- **The voice**: Kokoro's `af_heart` at speed 0.81, today's pauses between
  lines (decision 4). Chosen by ear on 2026-09-30 from six renders of one
  EVOLVE passage, over the same voice at today's speed with more room between
  sentences, over `af_bella`, and over `bf_emma`.
- **Pace**: at 0.81 the voice speaks at about 176 words a minute, and a
  chapter's narration runs at about 160 overall, pauses included (the
  audition passage measured 176 and 160; today's films speak at 195–203).
  `asr_check.py` targets a speaking rate of 176, reports the overall rate
  beside it, and fails a film that speaks faster than 185. Each chapter also
  holds a few seconds of picture and sound with no narration.
- **Explain, then show**: every chapter opens with a computed figure (the film
  kit's primitives, under part 8's rules) that states the idea, and then the
  real app shows it. The view films and the illustrated films become one form.
- **Casting**, as in part 6, and a review at preview before anything is
  published (already in the runbook).

### 8. Explanation in the app

The app explains state, not causation. The direction is one grammar for
explanatory graphics, shared by `www/viz/viz.js`, the app's canvases and the
film kit. It takes viz.js's four rules for all three: compute rather than
illustrate; re-theme through the tokens; work from the keyboard, with status
readouts; under reduced motion, show the end state. It adds two more: tell
categories apart by shape, position and label, never by five ambers (TA6); and
respect the canvas text floor. These figures are where part 5's third level
goes: what the app says today in paragraphs and captions, it shows. Candidates
for explaining causation, each its own small proposal:

- why this pair was dealt;
- what a pick changed, shown before and after on the map;
- why a patch sounds as it does: its signal flow with the measured level on
  each cable (the rack already half does this);
- what a generation did: each child beside its parent, the knobs that moved
  drawn as moves, in place of the lineage log's sentences of numbers.

## Sequencing

1. This proposal, decided (2026-09-30) and accepted.
2. The tokens, the voice guide and the fixes to the marks (parts 1–3): small,
   and everything after builds on them.
3. The component set, the type scale, the grid and the motion tokens, and each
   view's disclosure map, drafted as specimens and approved (parts 4 and 5).
4. The views rebuilt to them, one at a time, with the text budget's check.
   Wave 2 is split (decision 7). The contracts that do not
   depend on the new components go ahead now in Plan-003: the word table and
   its check (task 1), the take-back registry (task 3), the keymap and MIDI
   learn rows (task 5, less the printed key hints), and bank stability
   (task 6). The ones that are about how the views look and speak are built
   into the rebuild instead of being applied to views about to be replaced:
   the colour looks (task 2), the message channels and the one onboarding
   surface (task 4), and the printed key hints. Plan-003's task 7, the films,
   becomes this proposal's step 7.
5. The sonic floor (RFC-005), with #62, alongside steps 3 and 4.
6. Explanation in the app (part 8), starting with one candidate.
7. The films' second pass (part 7), filming the improved app.

## Alternatives considered

- **Leave the rules where they are and fix drift case by case.** The drift
  listed above is what that produced.
- **Trim the app's text in place.** `ui-hierarchy.md` did that for PATCH, and
  the sentences came back with the next features. Without components that
  hold the budget and a check that measures it, they will again.
- **Apply all of Wave 2 to today's views, then refresh.** The colour looks,
  channels and onboarding would be built twice, on views about to be replaced.
- **Rebrand.** The mark, the logotype and the colour law are coherent and
  specified; the problems are consistency and gaps, not identity.
- **Start with a designer.** Decided against for now (decision 5): each
  specimen is drafted as a visual page and approved before it is built. A
  designer can still be brought in for a part that does not hold up.

## Consequences

- One place to change a colour, a size or a word, and checks that catch the
  next drift, including the next sentence of guidance.
- The views are rebuilt, one at a time: a larger change than Wave 2, and the
  films wait for it.
- Explanation moves out of tooltips and paragraphs into figures and the guide.
  The guide carries more of the prose, so its pages are checked against the
  new views as each lands (ADR-004).
- Films take longer to make (casting, explanation segments, a review) and to
  watch: at speed 0.81 the same narration runs about a tenth longer, before
  the explanation segments.
- If filtered first deals move the search's measured numbers, revalidation is
  owed (RFC-005 says).

## Decisions (maintainer, 2026-09-30)

1. The tagline is **"A synthesizer that searches for your sound"**. The
   descriptor is drafted in the voice guide.
2. **Light mode for the docs only**, specified in the tokens; the brand spec
   is amended to allow it.
3. **No UI sounds.**
4. **The voice is `af_heart` at speed 0.81**, chosen by audition.
5. **Claude drafts** the icon set, the type scale, the layout grid, the
   components and each view's disclosure map as visual specimens; **the
   maintainer approves** each before it is built.
6. **The sonic floor governs the first deals and the films' casting only.**

The maintainer also asked for the UI components and the interaction design to
be refreshed, each view's experience rethought around progressive disclosure,
and far less text in the app: part 5.

7. **Wave 2 is split** as Sequencing step 4 proposes: the non-visual
   contracts go ahead in Plan-003, and the colour looks, channels, onboarding
   surface and printed key hints are built into the rebuild.

Accepted as [ADR-011](../decisions/011-one-design-system.md). Built as
[Plan-004](../plans/004-one-design-system.md), with Plan-003 keeping Wave 2's
other contracts; RFC-005 takes the sonic floor.
