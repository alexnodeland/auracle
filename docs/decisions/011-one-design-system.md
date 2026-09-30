---
title: "One design system: one source, shared components, a text budget, and films that explain"
number: 11
status: accepted
author: Claude Code
created: 2026-09-30
originating_proposal: 4
superseded_by: null
---

# ADR-011: One design system: one source, shared components, a text budget, and films that explain

## Status

Accepted

## Context

The first round of view films (2026-09-29) was held: the narration was too
fast, the sounds on camera were harsh, and the films showed the app without
explaining it. The app has the same gaps. Its visual and verbal rules existed
but were spread over six places and had drifted. Its layout rules
(`docs/notes/ui-hierarchy.md`) had come undone, and every view showed five or
six sentences of guidance at rest (`docs/notes/text-2026-09/`) (RFC-004).

## Decision

- **One source.** `www/brand/` holds the marks, the tokens
  (`tokens.json`, generated into every surface's CSS), the voice guide, and
  the sound and film direction. `make dev-check` fails on a colour, size or
  duration defined anywhere else.
- **Words.** One voice guide, `www/brand/voice.md`, with four registers
  (silk, plain, the model's voice, narration). The tagline is "A synthesizer
  that searches for your sound". British spelling.
- **Marks.** The mark, logotype and lockups stay. The icon set replaces the
  app's glyphs, and no emoji-presentation glyph remains in the UI.
- **Picture.** One type scale with a floor for canvas labels, a layout grid,
  motion tokens, and nothing moving without meaning. The app, the landing
  page and the films are dark; the docs also have a light theme.
- **Components and disclosure.** The views are built from one component set.
  Each view has three levels (at rest; on approach; on request). At rest a
  view shows at most one sentence of guidance, from one surface. There are no
  placeholder rows, no long blocks of text outside the guide, and a tooltip
  holds a name and a key. A browser spec measures this; its limits are set in
  Plan-004.
- **Drafted, then built.** Claude drafts the icon set, the type scale, the
  grid, the components and each view's disclosure map as visual specimens,
  and the maintainer approves each before it is built.
- **Sound.** The app makes no UI sounds. A sonic floor governs a session's
  first deals and the films' casting, and nothing after that (RFC-005).
- **Films.** The voice is `af_heart` at speed 0.81, chosen by ear. A check
  fails a film that speaks too fast (its limit is set in Plan-004). Each
  chapter explains with a computed figure, then shows the app.
- **Wave 2 is split.** The word table and its check, the take-back registry,
  the keymap and bank stability stay in Plan-003. The colour looks, the
  message channels and onboarding surface, and the printed key hints are
  built into the rebuilt views (Plan-004).

## Options Considered

### Option 1: Fix drift case by case, and trim text in place

How the drift and the text happened; rejected.

### Option 2: Rebrand

The identity is coherent; the problems are consistency and gaps. Rejected.

### Option 3: One system, built into components and checked (chosen)

Costs a rebuild of each view, one at a time, and the films wait for it.

## Consequences

- A colour, size, word or sentence of guidance that breaks the system fails a
  check, not a review.
- New UI is composed from the component set. A view that needs a new kind of
  control adds it to the set, drafted and approved like the rest.
- Explanation lives in figures, the ? card's map and the guide, not in
  tooltips and paragraphs.
- `apps/web/AGENTS.md` and `www/AGENTS.md` point here and to
  `www/brand/voice.md` once it exists.
