---
title: "Design direction: one system for words, marks, picture, sound and explanation"
number: 4
status: draft
author: Claude Code
created: 2026-09-29
updated: 2026-09-29
supersedes: null
superseded_by: null
---

# RFC-004: Design direction

## Audience

The maintainer, who decides the open questions at the end, and anyone who
writes copy, draws UI, makes a film or chooses the first sounds a player
hears. [RFC-003](003-one-instrument-contracts.md) (Wave 2) fixes the shared
words, colours, undo, messages and keys across the views; this proposal sets
the direction those contracts serve, and covers what they leave out.

## Context

Watching the first round of view films (recorded 2026-09-29, held rather than
published; see [the film runbook](../runbooks/finish-the-view-films.md)) made
four gaps plain:

- **Too fast.** The narration measured 195–203 words a minute in all six
  films. The pipeline's own target is 160 (`TARGET_WPM` in
  `www/video/voice/asr_check.py`) and `www/video/films/VIEWS.md` asks for
  150–170. The voice runs at speed 0.9; the ASR reports compute about 0.72
  for 160.
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
- **UI quality.** The interaction review's quality findings (layout, density,
  legibility, motion) are still open: B's controls spread over three rows
  (PF-08), scopes take most of EVOLVE while its teaching surface is 10 px
  (EV-19), knob names vanish at 1280 px (PA-15), five ambers that cannot be
  told apart (TA6), 10 px canvas labels (TA20), ▶ in seven forms (CO4),
  button families that follow no rule (CO8)
  ([`findings.json`](../notes/interaction-2026-09/findings.json)).

Most of a direction already exists. It is spread out, and it has drifted:

- **A brand spec** ([`www/brand/index.html`](../../www/brand/index.html), "the
  specification … also the specimen"): the mark (an aura outward, a posterior
  inward), the logotype (Jost caps on a tracking ramp), four lockups, the lamp
  rule and a five-icon set.
- **A colour law and a type law**, stated at the top of five stylesheets:
  two phosphors (green is sound, amber is the model's mind), silk ink, no
  third colour; Jost for the panel's silkscreen, IBM Plex Mono for values,
  Newsreader italic for the model speaking.
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

## Proposal

One design system, written down once, generated into every surface, and
checked. Seven parts.

### 1. One source

`www/brand/` becomes the single source for everything visual and verbal: the
marks (as now), the tokens, the voice guide, and the sound and film direction.
The tokens (colour, type scale, spacing, radii, motion durations and easings)
live in one file, `www/brand/tokens.json`, and a build step writes the CSS each
surface imports: app, landing, docs theme, film stage and film kit. A check in
`make dev-check` fails on a colour, size or duration defined anywhere else, and
on a raw hex in a rule (well over a hundred in `apps/web/style.css` today,
outside its tokens). The drift above then cannot recur.

### 2. Voice and tone

One guide, `www/brand/voice.md`, replaces the six scattered sets of rules,
which then point to it. It states:

- **Who each surface speaks to**: the player in the app and the guide, the
  curious in the reference, someone deciding on the landing page, the viewer
  of a film.
- **Four registers.** *Silk*: panel labels and the things you press, a noun
  or a verb, never a sentence. *Plain*: toasts, status lines and the guide;
  sentence case, present tense, second person, one idea a sentence, no
  marketing adjectives. *The model's voice*: Newsreader italic, lowercase and
  declarative, naming its limits as facts, reserved for what the model
  believes and why. *Narration*: speak to *you*, show then say, at 150–165
  words a minute.
- **Words**: RFC-003's word table, and the banned-words check it calls for,
  built at last (`www/checknames.py` checks only code names today).
- **Claims**: ADR-004 as it stands; no number a seed can move.
- **One tagline and one descriptor** (open question 1).
- **Spelling**: British (colour, centre), which the site already mostly uses.

### 3. Marks

Keep the mark, the logotype and the four lockups: they are coherent and fully
specified. Fix the surfaces that disagree with the spec: the lamp is amber on
the brand page too; the docs header follows the tracking ramp; the social card
uses the stacked lockup with the descriptor. Wire the icon set into the app and
extend it to every action the app now shows as a glyph (▶ in one form, ⚡,
save, cut, star, undo), on the set's 24 px grid, 2 px stroke and
`currentColor`. No emoji-presentation glyph remains in the UI.

### 4. Picture: layout, type and motion

- **One type scale**, one ratio, shared by the app, the landing page, the docs
  and the films (the films use it at 1080p multiples), with a floor for canvas
  labels (proposed 12 px; TA20 found 10 px too small).
- **A layout grid and a density rule** for the views, framed by the three
  levels in [`ui-hierarchy.md`](../notes/ui-hierarchy.md): the sound largest,
  one primary action per view, nothing at level 3 taking space at rest. The
  quality findings (PF-08, EV-19, PA-15, PA-16, PA-22, EV-04, EV-15) are fixed
  against it.
- **Control families**: one look per kind (primary, secondary, toggle,
  destructive, disclosure), closing CO8, and ▶ in one form, closing CO4.
  Plan-003 does not yet name either; add them to it.
- **Motion**: tokens (three durations, two easings) and one rule: nothing
  moves without meaning. Every animation says that something changed, is
  happening, or needs you. The idle pulses go.
- **Light mode**: open question 2.

### 5. Sound

Two kinds: the app's patches, and the films' sound.

- **The first sounds a player hears are good.** Today the boot fill, the
  warm start and the first duels deal whatever the prior draws. The direction
  is a *sonic floor* measured by the engine: harshness (for example sensory
  roughness and the share of energy far above the laptop band), noise
  dominance, and register (#62). It is used three ways: the prior draws less
  from below it (the reweighting #62 proposes, extended), a session's first
  deals come from above it, and the model goes on learning taste above it.
  The vet stays a pathology gate. The engineering is its own proposal
  (RFC-005), because a new measurement touches φ's contract and owes
  `make revalidate`.
- **UI sounds**: open question 3 (today there are none).
- **Films cast their sounds rather than dealing them.** A walkthrough plays
  presets, or patches chosen from above the floor, not whatever the seed
  deals. The app's audio sits a set amount under the narration, and the bed
  follows `VIEWS.md` (out under a demo). A film's sounds are listened to and
  approved before recording.

### 6. Films

- **Pace**: 150–165 words a minute, enforced. `asr_check.py` fails a film
  over 175 (today it only reports the rate). Each chapter also holds at least
  a few seconds of picture and sound with no narration.
- **Explain, then show**: every chapter opens with a computed figure (the film
  kit's primitives, under part 7's rules) that states the idea, and then the
  real app shows it. The view films and the illustrated films become one form.
- **Casting**, as in part 5, and a review at preview before anything is
  published (already in the runbook).
- **The voice**: open question 4. Kokoro's `af_heart` slowed to 0.72 may not
  hold up.

### 7. Explanation in the app

The app explains state, not causation. The direction is one grammar for
explanatory graphics, shared by `www/viz/viz.js`, the app's canvases and the
film kit. It takes viz.js's four rules for all three: compute rather than
illustrate; re-theme through the tokens; work from the keyboard, with status
readouts; under reduced motion, show the end state. It adds two more: tell
categories apart by shape, position and label, never by five ambers (TA6); and
respect the canvas text floor. Candidates for explaining causation, each its
own small proposal:

- why this pair was dealt;
- what a pick changed, shown before and after on the map;
- why a patch sounds as it does: its signal flow with the measured level on
  each cable (the rack already half does this).

## Sequencing

1. This proposal, decided (the open questions below).
2. The tokens, the voice guide and the fixes to the marks (parts 1–3): small,
   and Wave 2 builds on them.
3. The sonic floor (RFC-005) with #62, alongside Wave 2 (Plan-003, extended
   with part 4's control families and motion).
4. Explanation in the app (part 7), starting with one candidate.
5. The films' second pass (part 6), filming the improved app.

## Alternatives considered

- **Leave the rules where they are and fix drift case by case.** The drift
  listed above is what that produced.
- **Rebrand.** The mark, the logotype and the colour law are coherent and
  specified; the problems are consistency and gaps, not identity.
- **Start with a designer.** Worth it for the icon set, the type scale and the
  layout grid (open question 5); consolidating the rules and building the
  checks does not need one.

## Consequences

- One place to change a colour, a size or a word, and checks that catch the
  next drift.
- Wave 2 gets a direction to build to, not only contracts to meet.
- Films take longer to make (casting, explanation segments, a review) and to
  watch: at 160 words a minute the same script runs about a quarter longer.
- The sonic floor changes what the prior draws, so the search's measured
  numbers move and revalidation is owed.

## Decisions (maintainer)

Open:

1. **Tagline and descriptor.** "A synthesizer that learns your taste", "…that
   searches for your sound" (the review argues it over-promises: the model can
   represent directions, not a place), or something new.
2. **Light mode.** None, as the brand spec says, or a specified paper theme
   for the docs only.
3. **UI sounds.** None, or a small set played by Auracle's own presets.
4. **The narration voice.** Kokoro's `af_heart` slowed to about 160 words a
   minute, another Kokoro voice, or a recorded human voice.
5. **A designer.** For the icon set, the type scale and the layout grid; or
   Claude drafts and the maintainer approves.
6. **How strict the sonic floor is.** Only the first session's deals, or the
   prior's draws throughout.
