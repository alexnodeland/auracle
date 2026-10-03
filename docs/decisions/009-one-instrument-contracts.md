---
title: "One vocabulary, one colour contract, one undo, one keymap across the instrument"
number: 9
status: accepted
author: Claude Code
created: 2026-09-28
originating_proposal: 3
superseded_by: null
---

# ADR-009: One vocabulary, one colour contract, one undo, one keymap across the instrument

## Status

Accepted. [ADR-016](016-space-plays-everywhere.md) supersedes one point:
Space plays the sound you're playing in every view, and is not a PERFORM pad
key. [ADR-017](017-the-levels-keys.md) amends another: the views are levels,
reached with ⌥ and an arrow and ⌥1–5, in place of ⌥1–4.

*Note (2026-10-02):* ⇧F in PERFORM opens stage mode, replacing F's accent
there (Shift with a note key plays it harder); in every other view ⇧F is
still the accented F. ADR-016 is unaffected.

## Context

The interaction review (`docs/notes/interaction-2026-09/`) found that a
quarter of its 119 findings came from one cause: each view chose its own words,
colours, undo and keys, so one idea wore many forms (RFC-003).

## Decision

The instrument keeps six contracts, each written once in code and guide and
checked where it can be:

- **Words**: the table in RFC-003 (pick, TAUGHT, fair-test picks, save,
  download/open, keep, keep as new, pool/bank, replaced, the patch you're
  playing, another pair, listening…, ideas, style, set aside, 59%), kept by a
  banned-words check in `make dev-check`.
- **Colour**: green is sound, amber is the model, red is danger and failure,
  silk is you and neutral; up/down/hit/miss are words or glyphs, never colour
  alone. Written as the header of `apps/web/style.css`.
- **States**: acknowledged within 100 ms on the thing touched; progress after
  1 s; the job slot after 3 s; a guess drawn as a guess.
- **Undo**: one ⌘Z for teaching acts (pick, take, pass, star, cut, save), each
  7 s from when its receipt shows; edit undo belongs to PATCH.
- **Messages**: the thing touched, the toast (results of your gesture), the
  status line, the job slot, the alarm (red), one onboarding surface per view.
- **Keys and stability**: the RFC-003 keymap (N means next; Space/Enter/B/
  ⇧Enter/⇧Space for PERFORM's pads; ⌥1–4 for views; ↑/↓ in EVOLVE), printed on
  the controls; a bank row click stays in the view; nothing re-sorts under the
  pointer.

## Options Considered

### Option 1: Fix each view as findings arrive

How the drift happened; rejected.

### Option 2: One set of contracts (chosen)

Costs a pass over every view and a film re-record, once.

## Consequences

- New UI copy, colours and keys follow the contracts; a change that needs an
  exception amends this ADR (by a new one that supersedes it).
- `apps/web/AGENTS.md` carries a one-line rule pointing here.
