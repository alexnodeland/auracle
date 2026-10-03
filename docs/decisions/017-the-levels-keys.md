---
title: "The levels' keys: ⌥ and an arrow, ⌥1–5, hold ⌥, ⌘K"
number: 17
status: accepted
author: Claude Code
created: 2026-10-02
originating_proposal: 6
superseded_by: null
---

# ADR-017: The levels' keys

## Status

Accepted by the maintainer (Plan-008, §6 Q1). It amends one point of
[ADR-009](009-one-instrument-contracts.md): "⌥1–4 for views". The rest of
ADR-009 stands, and [ADR-016](016-space-plays-everywhere.md) (Space plays the
sound you're playing everywhere) is unchanged.

## Context

RFC-006 makes the five views one space around the sound in hand: TASTE zoomed
out, PERFORM the sound, PATCH zoomed in, LEARNING past TASTE, and EVOLVE beside
PERFORM. Plan-008 builds it as levels with a rail at the stage's right edge in
place of the tabs. ADR-009 gave the views ⌥1–4, which was never built (no ⌥
handling existed), and there are five levels now, on an axis with one level
beside it. The approved prototype binds ⌥ and the arrows to that geometry,
⌥1–5 to the levels, a held ⌥ to the model view, ⌘K to one list of
everything, and `-` and `=` to zoom.

## Decision

- **⌥↑ zooms out and ⌥↓ zooms in** along PATCH, PERFORM, TASTE, LEARNING. At
  an end of the axis the key does nothing. From EVOLVE a step is measured from
  PERFORM, the level it sits beside.
- **⌥← goes to EVOLVE, and ⌥→ goes back** to PERFORM from it.
- **⌥1–5 go straight to** PERFORM, PATCH, EVOLVE, TASTE and LEARNING. The digit
  is read from the key's code, since ⌥1 types a character on a Mac.
- **They come first.** They are taken before any focused control (a knob turns
  on the arrows, a list walks on them), except in a text field, where on a Mac ⌥ and an
  arrow move by word (on Windows and Linux Alt ← there is the browser's Back,
  left to it), and under any modal dialog showing (the warm start, the commit
  pair, the ? card, stage mode, a lesson), whose level must not change
  unseen. Non-modal panels (MIDI, KEYS ⋯, the scope's settings, Compare)
  leave them working. ⌥ alone is taken too, since Firefox and Edge on Windows open the
  window's menu on it.
- **Holding ⌥ shows the model view** (after 220 ms; released, it goes; another
  key pressed meanwhile cancels it, so ⌥↑ never flashes it). Built in
  Plan-008 PR B.
- **⌘K (Ctrl K) opens the one list** of levels, actions and sounds. Built in
  PR D, which takes in ⋯ and the ? card.
- **`?` explains the control it is over** (explain.js), **and elsewhere opens
  the list** (PR D; until then the ? card).
- **`-` and `=` are not bound to zoom.** PATCH's ⌘− and ⌘= zoom its rack, and
  one stroke between the two would be one wrong level away.
- Off Apple platforms every printed ⌥ reads Alt (`platformKeys`).

## Options Considered

### Option 1: Keep ⌥1–4 for the views

Four digits for five levels, and nothing for the geometry the rail draws.
Rejected.

### Option 2: The prototype's keys, as above (chosen)

The arrows match the rail; the digits reach any level in one stroke.

### Option 3: The prototype's keys with `-` and `=`

Rejected for the clash with PATCH's camera keys.

## Consequences

- The keymap in `www/docs/src/keyboard.md` and the ? card say these keys, and
  the rail's stops carry their digit (`aria-keyshortcuts`, and the title).
- `apps/web/levels.js` holds the rules (`levelForKey`), unit-tested;
  `apps/web/shell.js` takes the keys.
- `apps/web/AGENTS.md`'s keymap line points here as well.
