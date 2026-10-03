---
title: "The pad keys: N, hold B, ⇧↵, ↵ and ⇧⌫"
number: 18
status: accepted
author: Claude Code
created: 2026-10-03
originating_proposal: 6
superseded_by: null
---

# ADR-018: The pad keys

## Status

Accepted by the maintainer (Plan-008, maintainer decisions round 2: "Pad keys
(ADR-018)"). It supersedes ADR-009's pad row (RFC-003's Space, Enter, B,
⇧Enter and ⇧Space for PERFORM's pads), and settles what
[ADR-016](016-space-plays-everywhere.md) left open: Peek's key, and the rest
"decided when built". ADR-009's "N means next" stands, and so does ADR-016
(Space plays the sound you're playing, in every view). ADR-017's level keys
are unchanged.

## Context

PERFORM had no pad keys: RFC-003's were never built, and ADR-016 took Space
from Peek. Plan-008 PR C1 lays PERFORM out to the approved prototype, whose
pads print N (Offer), B (Peek) and ⇧↵ (Take), with a fourth pad, PASS, and no
KEEP, BACK or FREEZE. The maintainer kept Keep, Back and Freeze as functions:
Keep and Back in a "moved · KEEP · BACK" bar shown when the sound has left
home, Freeze as a tap on Wander. The note keys (A W S E D F T G Y H U J K O L
P ; '), Z and X (octave), M (save), 1–5 (rate, and in EVOLVE 1 and 2 play its
pair), [ and ] (step the bank), / (PATCH's index), ? (the ? card, explain over
a control), ⇧F (stage mode in PERFORM), ⌥ with an arrow or a digit (the
levels), ← → in EVOLVE and R in LEARNING were taken; N and B were free
everywhere, Backspace in PERFORM (PATCH's rack deletes a module with it), and
Enter and ⇧Enter belong to whatever control has focus.

## Decision

In PERFORM, while it shows:

- **N: Offer, or Next** while B holds an offer (a pass and another offer).
  N is no note's key. In EVOLVE N is ANOTHER PAIR: N means next.
- **B held: Peek.** All of B while the key is down, back to Blend's mix when
  it comes up, or when the window loses focus.
- **⇧↵: Take** the offer in B. Not from a focused button, link, drop-down or
  text field, where Enter is theirs; a focused dial does not use ⇧↵, so it
  takes from there too.
- **↵: Keep**, only when no control has focus (a focused button presses, a
  focused control plays its sweep), and only when the sound has moved;
  otherwise it says there is nothing to keep.
- **⇧⌫: Back** to the last sound kept, when the sound has moved; otherwise it
  says there is nothing to go back to.
- **Freeze has no key.** A tap on Wander freezes it, and Enter on a focused
  Wander does the same.
- **PASS has no key.** It is a pass without growing another, and N is a pass
  with one.

None of them acts while typing in a text field, under a modal dialog (the
warm start, the commit pair, the ? card, stage mode, a lesson), or with ⌘,
Ctrl or ⌥ held. They are matched by the key's character, as the note keys
are. Each pad prints its key, and says it to assistive tech
(`aria-keyshortcuts`).

## Options Considered

### Option 1: RFC-003's keys

Enter Take, ⇧Enter Keep, B Back, ⇧Space Freeze, with Peek moved to V. The
prototype's printed keys would change, and ⇧Space would take a modifier of
Space, which ADR-016 gives to play in every view. Rejected.

### Option 2: The prototype's three, with Keep and Back only in the bar

N, B and ⇧↵, and no keys for Keep and Back. Rejected: the bar is for the
pointer, and a keyboard player keeps and goes back as often as they take.

### Option 3: The prototype's keys, ↵ Keep and ⇧⌫ Back (chosen)

The three printed keys, Keep on the plainest key when nothing else wants it,
and Back on Shift with Backspace, which is "undo where I went" in many
instruments and is free in PERFORM.

## Consequences

- `apps/web/perform.js` takes the keys (the pad keys, after the stage keys);
  `apps/web/main.js` takes N in EVOLVE.
- The keymap in `www/docs/src/keyboard.md` and the ? card say them.
- `apps/web/AGENTS.md`'s keymap line points here as well.
