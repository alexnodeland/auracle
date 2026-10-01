---
title: "One language across the views (Wave 2)"
number: 3
status: active
author: Claude Code
created: 2026-09-28
updated: 2026-09-30
originating_proposal: 3
related_adrs: [4, 9, 11]
---

# Plan-003: One language across the views (Wave 2)

## Objective

Implements [RFC-003](../proposals/003-one-instrument-contracts.md) under
[ADR-009](../decisions/009-one-instrument-contracts.md): every view uses the
same words, colours, undo, message channels and keys, and nothing moves under
the player's hands. Starts after Wave 1 (Plan-001 and the responsiveness
branch) has merged; the findings it closes are the Wave 2 rows of
`docs/notes/interaction-2026-09/findings.json`.

**Split on 2026-09-30** ([ADR-011](../decisions/011-one-design-system.md)):
the views are being rebuilt to one design system
([Plan-004](004-one-design-system.md)), so the tasks about how they look and
speak (2, 4, the printed key hints in 5, and 7) are built there, into the
rebuilt views, rather than applied to views about to be replaced. Tasks 1, 3,
5 and 6 go ahead here.

## Bounded contexts

| Context | Owns | Files |
| --- | --- | --- |
| Copy | Every player-facing string and the guide's quotes of them | `apps/web/*.js`, `index.html`, `www/docs/src/`, `www/reference/src/` |
| Colour | Tokens and their uses | `apps/web/style.css` (header contract), SVG/canvas colours in `main.js`, `perform.js` |
| Undo | The take-back registry and its labels | `main.js` (`holdTakeBack`, `takeBackNewest`), `perform.js` |
| Channels | Toast, status line, job slot, alarm, onboarding | `main.js` (`note()`, alarm), `perform.js` status, job slot from Plan-001 |
| Keys | The keymap, MIDI learn rows, printed key hints, the ? card | `main.js` key handler, `perform.js`, `midi.js`, `index.html`, `www/docs/src/keyboard.md` |
| Stability | Bank order, row clicks, the rack's camera | `main.js` (`renderBank`, bank row handlers, camera) |

## Tasks

1. **Words** (CO1, CO5, CO6, CO7, EV-12, TA9, PA-04, PA-05 naming): apply the
   RFC-003 table to UI copy and the guide in one pass; TAUGHT counter with the
   pick/star/cut breakdown tooltip; EVOLVE's meter sentence uses the pick
   count; "keep as new" for COMMIT; "set aside" for HELD; "pool" for the
   EVOLUTION tab; "replaced" everywhere. Add a banned-words check
   (`www/checkwords.py`, reading the list in `www/brand/voice.md`), run by
   `make dev-check`.
2. **Colour**: moved to Plan-004 task 6 (CO3, CO10, PA-08, TA6 partly, SH8, EV-07 item 1): write the
   contract as `style.css`'s header; dock toggles get a green LED + silk label;
   active tabs silk; alarms red; locks silk (pin + hatched halo); your names
   silk; forecast hit/miss and up/down as ✓ ✗ ▲ ▼ with amber; cursor row silk,
   focus a ring outside; saved rows read SAVED on approach with a filled
   floppy.
3. **Undo** (CO2 remainder, EV-02 stars, PF-07 pass): stars, PERFORM's Take
   and pass, and saves join the take-back registry; one UNDO label; windows
   from when the receipt shows (cuts too).
4. **Channels**: moved to Plan-004 task 6 (CO9, SH5 remainder, PF-05, TA11 remainder): one status line
   per view; Wander's state on Wander's caption; onboarding one surface at a
   time (the coach hides while first steps show); sentence case for toasts.
5. **Keys** (CO11, PF-09, EV-13, EV-09 ↑/↓, TA12, PA-12 Space): the keymap as
   one table in code and in `keyboard.md`; key hints printed on pads and
   buttons (moved to Plan-004 task 6); MIDI learn rows for PERFORM's pads and EVOLVE's picks; keyboard
   Peek latches until the next press or Esc.
6. **Stability** (SH1, SH6, EV-06, EV-08, PA-13): a row click plays in the
   current view with "↗ patch" and double-click to open PATCH; bank order
   freezes under the pointer and animates on leave; the live row stays in
   view; the rack keeps its zoom and the edited plate's neighbour after a
   structural edit.
7. **Films and screenshots**: moved to Plan-004 task 8. a truth pass over every film and guide
   screenshot, re-record what changed (`make film-record-all DRAFT=1` first),
   then publish.

## Done when

Every Wave 2 finding in tasks 1, 3, 5 and 6 is closed or explicitly deferred
with a reason (the rest close under Plan-004); the banned-words check runs in
`make dev-check`; a spec pins each keymap row, the take-back registry's acts,
and bank stability; the guide shows the new language.
