---
title: "One voice: the line, the words and the spoken voice, in one guide"
number: 13
status: accepted
author: Claude Code
created: 2026-09-30
originating_proposal: 4
superseded_by: null
---

# ADR-013: One voice

## Status

Accepted. It supersedes two points of [ADR-011](011-one-design-system.md): its
tagline and its spelling. The rest of ADR-011 stands.

## Context

[RFC-004](../proposals/004-design-direction.md) part 2 called for one voice
guide, `www/brand/voice.md`, to replace copy rules spread over six places.
Plan-004 task 2 was to write it.

An inventory on 2026-09-30 measured every rule and every surface. It found:
- rules in more than six places, some of them conflicting;
- at least eight taglines live at once;
- RFC-003's word table accepted but never applied, with no banned-words check;
- "patch" and "sound" used for the same thing;
- British spelling as the rule, but "toward", "math", and "color" in practice;
- em dashes in toasts and none in the docs;
- the italic voice given to three different speakers;
- film rules giving three speeds, three paces and two orders.

The maintainer decided the open questions and asked for tone guidelines "beyond
spelling and grammar", for both the written and the spoken voice.

## Decision

- **One guide.** [`www/brand/voice.md`](../../www/brand/voice.md) is the one
  set of language rules for every medium. It covers the app, the landing page,
  the launch film, the view and illustrated films, the guide, the reference,
  the README and the changelog. Other rule files point to it and don't restate
  it. Where one differs, the guide wins.
- **The line.** The tagline is **"A synthesizer that grows toward you."** and
  the descriptor is **"Pick the sound you'd reach for. It learns your ear, and
  every generation grows a little closer."**. Both were chosen by the
  maintainer, and they supersede "A synthesizer that searches for your sound".
- **The name** is said like "oracle".
- **Sound and patch.** A sound is what you hear, pick, save and breed, on every
  player-facing surface. A patch is how a sound is built.
- **American spelling,** superseding ADR-011's British.
- **No em dashes, anywhere.**
- **The character and the beliefs** the copy follows from, the tone by moment,
  and how Auracle talks about sound, the model and the player.
- **Only the model speaks in the italic voice.**
- **The spoken voice:**
  - the narrator's character;
  - writing for the ear;
  - silence;
  - the grammar: explain, pause, demo, continue, with nothing played under
    speech;
  - the shape of a film.
- **The word table** is RFC-003's, restated and extended with RFC-006's nouns.
  The banned-words check in `make dev-check` keeps it (Plan-003 task 1), and it
  reads its list from the guide.

## Options Considered

### Option 1: Keep the rules where they are, and reconcile them

Six files, each owned by a different kind of writer, drift apart again.
Rejected.

### Option 2: Spelling and grammar only

This settles the mechanics but not the voice. The maintainer asked for more.
Rejected.

### Option 3: One guide, character first, mechanics as reference (chosen)

It costs a sweep of every surface's copy, done in passes and kept by the check.

## Consequences

- Copy moves to the line, the word table, American spelling and no em dashes,
  surface by surface. Until each surface's pass lands, the guide states the
  target, not the state.
- The banned-words check is built against the guide's list. Copy that breaks it
  fails `make dev-check`, not a review.
- `www/AGENTS.md`, `apps/web/AGENTS.md`, `www/video/AGENTS.md`, the
  docs-writer and film-producer agents, the changelog skill, `VIEWS.md` and
  `SCRIPTS.md` point to the guide.
- The film sound's specification (RFC-007) takes the spoken grammar and the
  bed's place under the voice from here.
