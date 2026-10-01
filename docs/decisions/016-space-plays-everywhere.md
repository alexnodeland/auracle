---
title: "Space plays the sound you're playing, in every view"
number: 16
status: accepted
author: Claude Code
created: 2026-10-01
originating_proposal: 6
superseded_by: null
---

# ADR-016: Space plays the sound you're playing, in every view

## Status

Accepted. It supersedes one point of [ADR-009](009-one-instrument-contracts.md):
Space as a PERFORM pad key. The rest of ADR-009 stands.

## Context

ADR-009 took RFC-003's keymap, which gave PERFORM's pads Space, Enter, B,
⇧Enter and ⇧Space, with Space held for Peek. That pad keymap was never built.
The guide, the ? card and Plan-005 task 12 say Space plays the sound you're
playing in every view, and RFC-006's PATCH check found Space in PERFORM and
EVOLVE playing the saved recording instead of the edit. #88 made the app match
the guide: Space plays the bench everywhere, a focused setting cycles on Enter,
and Space stays with a native button or a control whose own handler takes it.

## Decision

- **Space plays the sound you're playing, as edited, in every view.** It waits
  for an edit still at the engine, as ▶ does.
- **When PERFORM's pad keys are built,** Peek takes a key other than Space. The
  rest of RFC-003's pad keymap (Enter, B, ⇧Enter, ⇧Space) is decided then,
  against what the app does by that time.
- **A focused setting** (a chip on the rack) cycles on Enter, and ⇧Enter goes
  back.

## Options Considered

### Option 1: Hold Space for Peek in PERFORM

Tap plays, hold peeks. One key with two meanings by duration, in one view only,
against what every other view and the guide say. Rejected by the maintainer.

### Option 2: Space plays everywhere (chosen)

One meaning for Space across the instrument; Peek gets its own key later.

## Consequences

- The keymap in `www/docs/src/keyboard.md` and the ? card are the reference for
  Space.
- `apps/web/AGENTS.md`'s keymap line points here as well as to ADR-009.
